/**
 * Pure host-side functions that build render-ready chart payloads.
 * Assembled once in buildSnapshot(); the webview only paints, never aggregates.
 */
import {
  BudgetState,
  CategoryBreakdownData,
  ChartData,
  COST_CATEGORIES,
  CostCategory,
  DailyBarsData,
  DailyBarPoint,
  Filter,
  Forecast,
  HeatmapData,
  ModelBreakdownData,
  TopEntry,
  UsageAggregate,
  UsageEvent,
} from './types';
import { matchesFilter } from './aggregate';
import { bucketKey, DAY_MS, startOf } from '../util/time';

const DAILY_BARS_WINDOW = 30;
const HEATMAP_WEEKS = 12;

function shortModelName(id: string): string {
  return id.replace(/^(models\/|openai\/|anthropic\/|google\/)/, '').slice(0, 32);
}

export function buildDailyBarsData(
  dayAggregates: UsageAggregate[],
  budget: BudgetState,
  forecast: Forecast,
  now: number,
): DailyBarsData {
  const byKey = new Map<string, UsageAggregate>(dayAggregates.map((a) => [a.bucketKey, a]));
  const dailyBudget = budget.includedCredits > 0 ? budget.includedCredits / DAILY_BARS_WINDOW : 0;

  const points: DailyBarPoint[] = [];
  for (let i = DAILY_BARS_WINDOW - 1; i >= 0; i--) {
    const ts = startOf(now - i * DAY_MS, 'day');
    const key = bucketKey(ts, 'day');
    const agg = byKey.get(key);
    const credits = agg?.credits ?? 0;
    const cost = agg?.cost ?? 0;

    const d = new Date(ts);
    const date = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    let colorIndex = 0;
    if (dailyBudget > 0) {
      const ratio = credits / dailyBudget;
      if (ratio >= 1.0) colorIndex = 2;
      else if (ratio >= 0.7) colorIndex = 1;
    }

    points.push({ date, credits, cost, colorIndex });
  }

  const budgetLine = dailyBudget > 0 ? dailyBudget : null;
  const projectedLine =
    forecast.basis !== 'insufficient-data' ? forecast.projectedCredits / DAILY_BARS_WINDOW : null;

  return { points, budgetLine, projectedLine };
}

export function buildModelBreakdownData(topModels: TopEntry[]): ModelBreakdownData {
  const top = topModels.slice(0, 8);
  return {
    labels: top.map((m) => shortModelName(m.key)),
    credits: top.map((m) => m.credits),
    costs: top.map((m) => m.cost),
    tokens: top.map((m) => m.tokens),
  };
}

export function buildHeatmapData(dayAggregates: UsageAggregate[], now: number): HeatmapData {
  const today = startOf(now, 'day');
  const start = today - HEATMAP_WEEKS * 7 * DAY_MS;
  const byStart = new Map<number, number>(dayAggregates.map((a) => [a.start, a.credits]));

  const cells: Array<{ date: string; value: number }> = [];
  let max = 0;
  for (let d = start; d <= today; d += DAY_MS) {
    const value = byStart.get(d) ?? 0;
    const date = new Date(d).toISOString().slice(0, 10);
    cells.push({ date, value });
    if (value > max) max = value;
  }

  return { cells, max };
}

/**
 * Spend split by cost category, summed from each event's `costByCategory`.
 * When no event carries a breakdown, returns `available: false` so the UI
 * hides the chart rather than showing a misleading single bucket.
 */
export function buildCategoryBreakdownData(
  events: UsageEvent[],
  f?: Filter,
): CategoryBreakdownData {
  const totals = new Map<CostCategory, number>();
  let any = false;
  for (const e of events) {
    if (!matchesFilter(e, f)) continue;
    if (!e.costByCategory) continue;
    for (const [cat, val] of Object.entries(e.costByCategory)) {
      if (val == null || val <= 0) continue;
      any = true;
      totals.set(cat as CostCategory, (totals.get(cat as CostCategory) ?? 0) + val);
    }
  }
  if (!any) return { categories: [], costs: [], available: false };
  const categories = COST_CATEGORIES.filter((c) => (totals.get(c) ?? 0) > 0);
  return {
    categories,
    costs: categories.map((c) => totals.get(c) ?? 0),
    available: categories.length > 0,
  };
}

export function buildChartData(
  dayAggregates: UsageAggregate[],
  topModels: TopEntry[],
  budget: BudgetState,
  forecast: Forecast,
  now: number,
  categoryBreakdown: CategoryBreakdownData,
): ChartData {
  return {
    dailyBars: buildDailyBarsData(dayAggregates, budget, forecast, now),
    modelBreakdown: buildModelBreakdownData(topModels),
    heatmap: buildHeatmapData(dayAggregates, now),
    categoryBreakdown,
  };
}
