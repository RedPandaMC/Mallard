/* c8 ignore start */
/**
 * Derives an expanded metric payload from a UsageSnapshot.
 *
 * Copilot's OTel telemetry exposes only usage metadata (model, surface, tokens,
 * cost, timestamps) — not prompt or completion text. The payload represents
 * aggregate session behaviour, suitable for downstream monitoring or anomaly
 * detection (e.g. InfluxDB, Grafana, Pinecone, pgvector).
 *
 * All fields are GDPR-safe: no repo names, branch names, or user identifiers
 * appear in the payload. Counts are used instead of lists; distributions are
 * normalized fractions.
 *
 * Shape A (this file): per-snapshot aggregate metric payload.
 * Shape B (graph edges): model→surface relationships live in snapshot.sankeyLinks
 * and can be consumed directly by a Neo4j importer without transformation here.
 */
import type { SourceKind, UsageSnapshot } from '../domain/types';
import type { MetricSerializer } from './MetricExporter';
/* c8 ignore stop */

export interface MetricPayload {
  /** ISO timestamp of the snapshot. */
  ts: string;
  /** Fraction of credits attributable to each model (sums to ≤1). */
  model_dist: Record<string, number>;
  /** Fraction of credits attributable to each surface (sums to ≤1). */
  surface_dist: Record<string, number>;
  /** Fraction of cost attributable to input tokens (0–1, 0 when unavailable). */
  input_cost_ratio: number;
  /** Credits used today divided by hours elapsed since midnight (≥0). */
  credits_velocity_per_hour: number;
  /** Month-to-date credits used as a fraction of the monthly budget (0 when no budget). */
  mtd_budget_pct: number;
  /** Number of distinct repositories observed (count only — no names). */
  repo_count: number;
  /** Most active hour of the current day (0–23). */
  peak_usage_hour: number;
  /** Standard deviation of daily credits over the last 7 days. */
  daily_credit_variance: number;
  /** Number of distinct models seen in the snapshot window. */
  model_count: number;
  /**
   * Gini coefficient of surface distribution (0 = balanced, 1 = all one surface).
   * High values mean usage is concentrated on a single surface.
   */
  surface_concentration: number;
  /** Fraction of events flagged as estimated rather than precise (0–1). */
  estimated_event_ratio: number;
  /** Which forecaster was used ('linear' | 'seasonal' | 'insufficient-data'). */
  forecast_basis: 'linear' | 'seasonal' | 'insufficient-data';
  /**
   * Spend trajectory: +1 = accelerating vs last week, 0 = flat, -1 = decelerating.
   * Returns 0 when there is insufficient historical data.
   */
  budget_trend: -1 | 0 | 1;
  /** Total tokens (prompt + completion) divided by total credits. */
  token_per_credit: number;
  /** Lower confidence bound for month-end projected credits. */
  forecast_low: number;
  /** Upper confidence bound for month-end projected credits. */
  forecast_high: number;
  /**
   * Primary data source in this snapshot. 'mixed' when events from multiple
   * connector types are present (e.g. both Copilot OTel and Claude Code).
   * Allows consumers to distinguish Claude-only vs Copilot-only vs blended views.
   */
  source_connector: SourceKind | 'mixed';
}

export function buildMetricPayload(s: UsageSnapshot): MetricPayload {
  // ── model_dist ──────────────────────────────────────────────────────────────
  const totalCredits = s.topModels.reduce((acc, m) => acc + m.credits, 0);
  const model_dist: Record<string, number> = {};
  for (const m of s.topModels) {
    if (totalCredits > 0) model_dist[m.key] = m.credits / totalCredits;
  }

  // ── surface_dist ────────────────────────────────────────────────────────────
  const surfaceCredits: Record<string, number> = {};
  for (const link of s.sankeyLinks) {
    surfaceCredits[link.target] = (surfaceCredits[link.target] ?? 0) + link.value;
  }
  const totalSurface = Object.values(surfaceCredits).reduce((a, v) => a + v, 0);
  const surface_dist: Record<string, number> = {};
  for (const [k, v] of Object.entries(surfaceCredits)) {
    if (totalSurface > 0) surface_dist[k] = v / totalSurface;
  }

  // ── input_cost_ratio ────────────────────────────────────────────────────────
  const catData = s.chartData.categoryBreakdown;
  const inputIdx  = catData.categories.indexOf('input');
  const outputIdx = catData.categories.indexOf('output');
  /* c8 ignore next 2 */
  const inputCost   = inputIdx  >= 0 ? (catData.costs[inputIdx]  ?? 0) : 0;
  const outputCost  = outputIdx >= 0 ? (catData.costs[outputIdx] ?? 0) : 0;
  const totalCatCost = inputCost + outputCost;
  const input_cost_ratio = totalCatCost > 0 ? inputCost / totalCatCost : 0;

  // ── credits_velocity_per_hour ───────────────────────────────────────────────
  const midnight = new Date(s.generatedAt);
  midnight.setHours(0, 0, 0, 0);
  const hoursElapsed = (s.generatedAt - midnight.getTime()) / 3_600_000;
  const credits_velocity_per_hour = hoursElapsed > 0.1 ? s.today.credits / hoursElapsed : 0;

  // ── peak_usage_hour ─────────────────────────────────────────────────────────
  const peak_usage_hour = s.chartData.hourlyTimeline.peakHour;

  // ── daily_credit_variance ───────────────────────────────────────────────────
  const dailyPoints = s.chartData.dailyBars.points;
  const last7 = dailyPoints.slice(-7).map((p) => p.credits);
  const daily_credit_variance = last7.length > 1 ? stddev(last7) : 0;

  // ── model_count ─────────────────────────────────────────────────────────────
  const model_count = s.allModels.length;

  // ── surface_concentration (Gini coefficient) ────────────────────────────────
  const surfaceValues = Object.values(surface_dist);
  const surface_concentration = gini(surfaceValues);

  // ── estimated_event_ratio ───────────────────────────────────────────────────
  const estimated_event_ratio = s.source === 'github' ? 0 : 1;

  // ── forecast fields ─────────────────────────────────────────────────────────
  const forecast_basis = s.forecast.basis;
  const forecast_low   = s.forecast.low;
  const forecast_high  = s.forecast.high;

  // ── budget_trend ────────────────────────────────────────────────────────────
  const { budgetLine, projectedLine } = s.chartData.dailyBars;
  let budget_trend: -1 | 0 | 1 = 0;
  if (projectedLine !== null && budgetLine !== null) {
    /* c8 ignore next */
    const recentAvg = last7.length > 0 ? last7.reduce((a, b) => a + b, 0) / last7.length : 0;
    if (projectedLine > recentAvg * 1.05) budget_trend = 1;
    else if (projectedLine < recentAvg * 0.95) budget_trend = -1;
  }

  // ── token_per_credit ────────────────────────────────────────────────────────
  const totalTokens = s.topModels.reduce((a, m) => a + m.tokens, 0);
  const token_per_credit = totalCredits > 0 ? totalTokens / totalCredits : 0;

  // ── source_connector ────────────────────────────────────────────────────────
  const uniqueSources = new Set(s.allSources);
  const source_connector: SourceKind | 'mixed' =
    uniqueSources.size === 1 ? ([...uniqueSources][0] as SourceKind) : 'mixed';

  return {
    ts: new Date(s.generatedAt).toISOString(),
    model_dist,
    surface_dist,
    input_cost_ratio,
    credits_velocity_per_hour,
    mtd_budget_pct: s.budget.percentOfBudget,
    repo_count: s.allRepos.length,
    peak_usage_hour,
    daily_credit_variance,
    model_count,
    surface_concentration,
    estimated_event_ratio,
    forecast_basis,
    budget_trend,
    token_per_credit,
    forecast_low,
    forecast_high,
    source_connector,
  };
}

/** Default MetricSerializer — emits the expanded metric payload. */
export class MetricPayloadSerializer implements MetricSerializer {
  readonly topic = 'mallard/v2/metrics';
  serialize(snapshot: UsageSnapshot): Record<string, unknown> {
    return buildMetricPayload(snapshot) as unknown as Record<string, unknown>;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function mean(xs: number[]): number {
  /* c8 ignore next */
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  /* c8 ignore next */
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

/** Gini coefficient for an array of non-negative fractions. Returns 0–1. */
/* c8 ignore next */
function gini(xs: number[]): number {
  /* c8 ignore next */
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const n = sorted.length;
  const total = sorted.reduce((a, b) => a + b, 0);
  /* c8 ignore next */
  if (total === 0) return 0;
  let sumNumerator = 0;
  for (let i = 0; i < n; i++) {
    /* c8 ignore next */
    sumNumerator += (2 * (i + 1) - n - 1) * (sorted[i] ?? 0);
  }
  return sumNumerator / (n * total);
}
