/* c8 ignore next */
/**
 * Derives the metric payload from a UsageSnapshot.
 *
 * Copilot's OTel telemetry exposes only usage metadata (model, surface, tokens,
 * cost, timestamps) — not prompt or completion text. The payload represents
 * aggregate session behaviour, suitable for downstream monitoring or anomaly
 * detection (e.g. InfluxDB, Grafana).
 *
 * All fields are GDPR-safe: no repo names, branch names, or user identifiers
 * appear in the payload. `instance_id` is a one-way SHA-256 hash of VS Code's
 * machineId — it lets a server tell two installs apart without identifying
 * either one.
 *
 * Design principle (schema v3): export ADDITIVE COUNTERS and PER-INSTANCE
 * GAUGES; leave ratio/derived statistics to the server, which can compute
 * them correctly across instances. Normalized fractions, local-time peak
 * hours, Gini coefficients and the like cannot be re-aggregated once
 * exported (an average of ratios is not the ratio of sums), so v3 sends the
 * absolute inputs instead.
 *
 * Aggregation semantics per field group:
 *   - gauges (mtd_*, today_*, forecast_*, budget_*): last() per instance_id
 *   - counters (total_*, estimated_event_count, *_credits maps): additive
 *     across instances at matching timestamps
 *   - tz_offset_minutes: metadata — lets the server align client-local day
 *     boundaries (all day/month windows here are client-local)
 */
import type { SourceKind, UsageSnapshot } from '../domain/types';
import type { MetricSerializer } from './MetricExporter';
import { hashMachineId } from '../util/machineId';

export interface MetricPayload {
  /**
   * Payload schema version. Additive changes (new optional fields) keep the
   * same version. Breaking changes (removals, renames, type changes) increment
   * it so consumers can branch on the value without inspecting the topic
   * string. See docs/reference/metrics-schema.md; the server accepts unknown
   * future versions tolerantly, so an extension can be upgraded ahead of its
   * server.
   */
  schema_version: 3;
  /** One-way SHA-256 hash of VS Code's machineId. Stable per install, not reversible. */
  instance_id: string;
  /** Unix epoch milliseconds of the snapshot. */
  ts: number;
  /**
   * Client UTC offset in minutes at snapshot time (e.g. +120 for CEST).
   * All "today"/"month-to-date" windows are client-local; this lets the
   * server align day boundaries across instances.
   */
  tz_offset_minutes: number;

  // ── Gauges: last() per instance ─────────────────────────────────────────────
  /** Month-to-date credits used (client-local month). */
  mtd_credits: number;
  /** Month-to-date cost in USD. */
  mtd_cost_usd: number;
  /** Credits used today (client-local day). */
  today_credits: number;
  /** Cost today in USD. */
  today_cost_usd: number;
  /** Month-to-date credits used as a fraction of the monthly budget (0 when no budget). */
  mtd_budget_pct: number;
  /** Which forecaster was used ('linear' | 'seasonal' | 'insufficient-data'). */
  forecast_basis: 'linear' | 'seasonal' | 'insufficient-data';
  /** Lower confidence bound for month-end projected credits. */
  forecast_low: number;
  /** Upper confidence bound for month-end projected credits. */
  forecast_high: number;
  /**
   * Spend trajectory: +1 = accelerating vs last week, 0 = flat, -1 = decelerating.
   * Returns 0 when there is insufficient historical data.
   */
  budget_trend: -1 | 0 | 1;
  /** Standard deviation of daily credits over the last 7 days. */
  daily_credit_stddev: number;

  // ── Counters: additive across instances ────────────────────────────────────
  /** Credits in the snapshot window (sums with other instances). */
  total_credits: number;
  /** Total tokens (prompt + completion) in the snapshot window. */
  total_tokens: number;
  /** Events in the snapshot window. */
  total_event_count: number;
  /** Events whose cost is estimated (log-derived) rather than authoritative. */
  estimated_event_count: number;
  /** Absolute credits per model id (not fractions — additive server-side). */
  model_credits: Record<string, number>;
  /** Absolute credits per surface. */
  surface_credits: Record<string, number>;
  /**
   * Absolute credits per detected programming language (VS Code languageId;
   * 'unknown' for events without one). Detection is heuristic — the active
   * editor at parse time — so treat this as directional, not authoritative.
   */
  language_credits: Record<string, number>;
  /** Absolute USD cost per cost category (input, output, cache read/write, thinking, tool). */
  cost_by_category: Record<string, number>;

  // ── Dimension metadata ──────────────────────────────────────────────────────
  /** All distinct model IDs seen in the current data (no other detail). */
  active_models: string[];
  /** The single most-used model by credits, or null if no data yet. */
  top_model: string | null;
  /** Number of distinct models seen in the snapshot window. */
  model_count: number;
  /** Number of distinct repositories observed (count only — no names). */
  repo_count: number;
  /**
   * Primary data source in this snapshot. 'mixed' when events from multiple
   * connector types are present (e.g. both Copilot OTel and Claude Code).
   * 'none' when the snapshot contains no events yet.
   */
  source_connector: SourceKind | 'mixed' | 'none';
}

export function buildMetricPayload(s: UsageSnapshot): MetricPayload {
  // ── Counters ────────────────────────────────────────────────────────────────
  const model_credits: Record<string, number> = {};
  for (const m of s.topModels) model_credits[m.key] = m.credits;

  const surface_credits: Record<string, number> = {};
  for (const link of s.sankeyLinks) {
    surface_credits[link.target] = (surface_credits[link.target] ?? 0) + link.value;
  }

  const language_credits: Record<string, number> = {};
  for (const l of s.byLanguage) language_credits[l.key] = l.credits;

  const catData = s.chartData.categoryBreakdown;
  const cost_by_category: Record<string, number> = {};
  for (let i = 0; i < catData.categories.length; i++) {
    const c = catData.costs[i]!;
    if (c > 0) cost_by_category[catData.categories[i]!] = c;
  }

  const total_credits = s.topModels.reduce((acc, m) => acc + m.credits, 0);
  const total_tokens = s.topModels.reduce((a, m) => a + m.tokens, 0);

  // ── daily_credit_stddev ─────────────────────────────────────────────────────
  const dailyPoints = s.chartData.dailyBars.points;
  const last7 = dailyPoints.slice(-7).map((p) => p.credits);
  const daily_credit_stddev = last7.length > 1 ? stddev(last7) : 0;

  // ── budget_trend ────────────────────────────────────────────────────────────
  const { budgetLine, projectedLine } = s.chartData.dailyBars;
  let budget_trend: -1 | 0 | 1 = 0;
  if (projectedLine !== null && budgetLine !== null) {
    /* c8 ignore next */
    const recentAvg = last7.length > 0 ? last7.reduce((a, b) => a + b, 0) / last7.length : 0;
    if (projectedLine > recentAvg * 1.05) budget_trend = 1;
    else if (projectedLine < recentAvg * 0.95) budget_trend = -1;
  }

  // ── source_connector ────────────────────────────────────────────────────────
  const uniqueSources = new Set(s.allSources);
  let source_connector: SourceKind | 'mixed' | 'none';
  if (uniqueSources.size === 0) source_connector = 'none';
  else if (uniqueSources.size === 1) source_connector = [...uniqueSources][0] as SourceKind;
  else source_connector = 'mixed';

  return {
    schema_version: 3,
    instance_id: hashMachineId(),
    ts: s.generatedAt,
    tz_offset_minutes: -new Date(s.generatedAt).getTimezoneOffset(),
    mtd_credits: s.budget.usedCredits,
    mtd_cost_usd: s.budget.usedCost,
    today_credits: s.today.credits,
    today_cost_usd: s.today.cost,
    mtd_budget_pct: s.budget.percentOfBudget,
    forecast_basis: s.forecast.basis,
    forecast_low: s.forecast.low,
    forecast_high: s.forecast.high,
    budget_trend,
    daily_credit_stddev,
    total_credits,
    total_tokens,
    total_event_count: s.totalEventCount ?? 0,
    estimated_event_count: s.estimatedEventCount ?? 0,
    model_credits,
    surface_credits,
    language_credits,
    cost_by_category,
    active_models: s.allModels,
    top_model: s.topModels[0]?.key ?? null,
    model_count: s.allModels.length,
    repo_count: s.allRepos.length,
    source_connector,
  };
}

/** Default MetricSerializer — emits the metric payload. */
export class MetricPayloadSerializer implements MetricSerializer {
  readonly topic = 'mallard/v3/metrics';
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
