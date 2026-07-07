/* c8 ignore next */
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
  DisplayPrefs,
  Filter,
  Forecast,
  HeatmapData,
  HourlyTimelineData,
  ModelBreakdownData,
  TopEntry,
  UsageAggregate,
  UsageEvent,
  WeekdayData,
} from './types';
import { PricingManifest } from './pricing';
import { matchesFilter } from './aggregate';
import { bucketKey, DAY_MS, startOf } from '../util/time';

const DAILY_BARS_WINDOW = 30;
// A full year, GitHub-contribution-graph style (schema caps this at 52).
const HEATMAP_WEEKS = 52;

function shortModelName(id: string): string {
  return id.replace(/^(models\/|openai\/|anthropic\/|google\/)/, '').slice(0, 32);
}

export function buildDailyBarsData(
  dayAggregates: UsageAggregate[],
  budget: BudgetState,
  forecast: Forecast,
  now: number,
  window = DAILY_BARS_WINDOW,
): DailyBarsData {
  const byKey = new Map<string, UsageAggregate>(dayAggregates.map((a) => [a.bucketKey, a]));
  const dailyBudget = budget.includedCredits > 0 ? budget.includedCredits / window : 0;

  const points: DailyBarPoint[] = [];
  for (let i = window - 1; i >= 0; i--) {
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
    forecast.basis !== 'insufficient-data' ? forecast.projectedCredits / window : null;

  let run = 0;
  const cumulativeCosts = points.map((p) => { run += p.cost; return run; });

  return { points, budgetLine, projectedLine, cumulativeCosts };
}

export function buildModelBreakdownData(
  topModels: TopEntry[],
  pricePerCredit: number,
  manifest?: PricingManifest,
  topN = 8,
): ModelBreakdownData {
  const top = topModels.slice(0, topN);
  const multipliers = manifest?.models ?? {};
  const allMultipliers = Object.values(multipliers).filter((v) => v > 0);
  const minMultiplier = allMultipliers.length > 0 ? Math.min(...allMultipliers) : 1;
  return {
    labels: top.map((m) => shortModelName(m.key)),
    credits: top.map((m) => m.credits),
    costs: top.map((m) => m.cost),
    tokens: top.map((m) => m.tokens),
    cheapestEquivalentCosts: top.map((m) => m.tokens * minMultiplier * pricePerCredit),
  };
}

export function buildHourlyTimelineData(events: readonly UsageEvent[], filter?: Filter): HourlyTimelineData {
  const hours = new Array(24).fill(0) as number[];
  // Compute local-timezone offset once; ±1 hour error possible at DST boundary,
  // acceptable for a usage heatmap.
  const tzOffsetMs = -new Date().getTimezoneOffset() * 60_000;
  for (const e of events) {
    if (!matchesFilter(e, filter)) continue;
    hours[Math.floor(((e.ts + tzOffsetMs) % DAY_MS) / 3_600_000) % 24]! += e.credits;
  }
  const max = Math.max(...hours);
  // null when there is no hourly activity — indexOf(0) would otherwise always
  // report midnight as the "peak".
  const peakHour = max > 0 ? hours.indexOf(max) : null;
  return { hours, peakHour };
}

/** Credits per weekday (index 0=Sun … 6=Sat) from raw events. */
export function buildWeekdayTotals(events: readonly UsageEvent[], filter?: Filter): number[] {
  const totals = new Array(7).fill(0) as number[];
  const tzOffsetMs = -new Date().getTimezoneOffset() * 60_000;
  for (const e of events) {
    if (!matchesFilter(e, filter)) continue;
    const day = Math.floor((e.ts + tzOffsetMs) / DAY_MS);
    // Epoch day 0 (1970-01-01) was a Thursday, so `day % 7 === 0` is Thursday,
    // not Sunday. Shift by +4 to anchor index 0 on Sunday, matching the SQL
    // dayofweek() path (0=Sun … 6=Sat).
    totals[(day + 4) % 7]! += e.credits;
  }
  return totals;
}

export function buildHeatmapData(dayAggregates: UsageAggregate[], now: number, weeks = HEATMAP_WEEKS): HeatmapData {
  const today = startOf(now, 'day');
  const byStart = new Map<number, number>(dayAggregates.map((a) => [a.start, a.credits]));
  const days = weeks * 7;

  const cells: Array<{ date: string; value: number }> = [];
  let max = 0;
  // Re-snap each day with startOf instead of adding a fixed DAY_MS, so DST
  // transitions don't drift the keys off the local-midnight aggregate starts.
  for (let i = days; i >= 0; i--) {
    const d = startOf(today - i * DAY_MS + DAY_MS / 2, 'day');
    const value = byStart.get(d) ?? 0;
    const dt = new Date(d);
    const date = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
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
  events: readonly UsageEvent[],
  f?: Filter,
): CategoryBreakdownData {
  const totals = new Map<CostCategory, number>();
  let any = false;
  for (const e of events) {
    if (!matchesFilter(e, f)) continue;
    if (!e.costByCategory) continue;
    for (const cat of COST_CATEGORIES) {
      const val = e.costByCategory[cat];
      if (val == null || val <= 0) continue;
      any = true;
      totals.set(cat, (totals.get(cat) ?? 0) + val);
    }
  }
  if (!any) return { categories: [], costs: [], available: false };
  const categories = COST_CATEGORIES.filter((c) => (totals.get(c) ?? 0) > 0);
  return {
    categories,
    /* c8 ignore next */
    costs: categories.map((c) => totals.get(c) ?? 0),
    available: categories.length > 0,
  };
}

/**
 * Builds a WeekdayData from a 7-element credits array (index 0=Sun … 6=Sat).
 * Returns zero-filled data if the array is empty or shorter than 7.
 */
export function buildWeekdayData(totals: number[]): WeekdayData {
  const filled = Array.from({ length: 7 }, (_, i) => totals[i] ?? 0);
  const peak = filled.indexOf(Math.max(...filled));
  return { totals: filled, peak };
}

/* c8 ignore next */
export function buildChartData(
  dayAggregates: UsageAggregate[],
  topModels: TopEntry[],
  budget: BudgetState,
  forecast: Forecast,
  now: number,
  categoryBreakdown: CategoryBreakdownData,
  hourlyTimeline: HourlyTimelineData,
  pricePerCredit: number,
  manifest?: PricingManifest,
  weekdayTotals?: number[],
  display?: DisplayPrefs,
): ChartData {
  return {
    dailyBars: buildDailyBarsData(dayAggregates, budget, forecast, now, display?.dailyBarsWindow),
    modelBreakdown: buildModelBreakdownData(topModels, pricePerCredit, manifest, display?.topN),
    heatmap: buildHeatmapData(dayAggregates, now, display?.heatmapWeeks),
    categoryBreakdown,
    hourlyTimeline,
    weekdayBreakdown: buildWeekdayData(weekdayTotals ?? []),
  };
}
