/**
 * Derives a numeric feature vector from a UsageSnapshot.
 *
 * Copilot's OTel telemetry exposes only usage metadata (model, surface, tokens,
 * cost, timestamps) — not prompt or completion text. The vector represents
 * aggregate session behaviour, suitable for downstream clustering or anomaly
 * detection (e.g. Pinecone, pgvector).
 *
 * Shape A (this file): per-snapshot aggregate vector.
 * Shape B (graph edges): model→surface relationships are in snapshot.sankeyLinks
 * and can be consumed directly by a Neo4j importer without transformation here.
 */
import type { UsageSnapshot } from '../domain/types';
import type { MetricSerializer } from './MetricExporter';

export interface VectorPayload {
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
  /** Number of distinct repositories observed in this snapshot window. */
  repo_count: number;
}

export function vectorize(s: UsageSnapshot): VectorPayload {
  const totalCredits = s.topModels.reduce((acc, m) => acc + m.credits, 0);
  const model_dist: Record<string, number> = {};
  for (const m of s.topModels) {
    if (totalCredits > 0) model_dist[m.key] = m.credits / totalCredits;
  }

  const surfaceCredits: Record<string, number> = {};
  for (const link of s.sankeyLinks) {
    surfaceCredits[link.target] = (surfaceCredits[link.target] ?? 0) + link.value;
  }
  const totalSurface = Object.values(surfaceCredits).reduce((a, v) => a + v, 0);
  const surface_dist: Record<string, number> = {};
  for (const [k, v] of Object.entries(surfaceCredits)) {
    if (totalSurface > 0) surface_dist[k] = v / totalSurface;
  }

  const catData = s.chartData.categoryBreakdown;
  const inputIdx = catData.categories.indexOf('input');
  const outputIdx = catData.categories.indexOf('output');
  const inputCost = inputIdx >= 0 ? (catData.costs[inputIdx] ?? 0) : 0;
  const outputCost = outputIdx >= 0 ? (catData.costs[outputIdx] ?? 0) : 0;
  const totalCatCost = inputCost + outputCost;
  const input_cost_ratio = totalCatCost > 0 ? inputCost / totalCatCost : 0;

  const midnight = new Date(s.generatedAt);
  midnight.setHours(0, 0, 0, 0);
  const hoursElapsed = (s.generatedAt - midnight.getTime()) / 3_600_000;
  const credits_velocity_per_hour = hoursElapsed > 0.1 ? s.today.credits / hoursElapsed : 0;

  return {
    ts: new Date(s.generatedAt).toISOString(),
    model_dist,
    surface_dist,
    input_cost_ratio,
    credits_velocity_per_hour,
    mtd_budget_pct: s.budget.percentOfBudget,
    repo_count: s.allRepos.length,
  };
}

/** Default MetricSerializer — emits the usage feature vector. */
export class VectorSerializer implements MetricSerializer {
  readonly topic = 'mallard/metrics';
  serialize(snapshot: UsageSnapshot): Record<string, unknown> {
    return vectorize(snapshot) as unknown as Record<string, unknown>;
  }
}
