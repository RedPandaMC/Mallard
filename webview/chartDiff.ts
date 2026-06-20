import type {
  DailyBarsData,
  HeatmapData,
  ModelBreakdownData,
  CategoryBreakdownData,
  HourlyTimelineData,
} from '../src/domain/types';

function numsEqual(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function strsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function dailyBarsChanged(prev: DailyBarsData | undefined, next: DailyBarsData): boolean {
  if (!prev) return true;
  if (prev.budgetLine !== next.budgetLine || prev.projectedLine !== next.projectedLine) return true;
  if (prev.points.length !== next.points.length) return true;
  return prev.points.some(
    (p, i) =>
      p.date !== next.points[i]!.date ||
      p.credits !== next.points[i]!.credits ||
      p.cost !== next.points[i]!.cost ||
      p.colorIndex !== next.points[i]!.colorIndex,
  );
}

export function heatmapChanged(prev: HeatmapData | undefined, next: HeatmapData): boolean {
  if (!prev) return true;
  if (prev.max !== next.max || prev.cells.length !== next.cells.length) return true;
  return prev.cells.some((c, i) => c.date !== next.cells[i]!.date || c.value !== next.cells[i]!.value);
}

export function modelBreakdownChanged(
  prev: ModelBreakdownData | undefined,
  next: ModelBreakdownData,
): boolean {
  if (!prev) return true;
  return (
    !strsEqual(prev.labels, next.labels) ||
    !numsEqual(prev.credits, next.credits) ||
    !numsEqual(prev.costs, next.costs) ||
    !numsEqual(prev.tokens, next.tokens) ||
    !numsEqual(prev.cheapestEquivalentCosts, next.cheapestEquivalentCosts)
  );
}

export function categoryBreakdownChanged(
  prev: CategoryBreakdownData | undefined,
  next: CategoryBreakdownData,
): boolean {
  if (!prev) return true;
  return (
    prev.available !== next.available ||
    !strsEqual(prev.categories, next.categories) ||
    !numsEqual(prev.costs, next.costs)
  );
}

export function hourlyChanged(
  prev: HourlyTimelineData | undefined,
  next: HourlyTimelineData,
): boolean {
  if (!prev) return true;
  return prev.peakHour !== next.peakHour || !numsEqual(prev.hours, next.hours);
}

/** Fallback for compound types without a dedicated comparator. */
export function changed<T>(prev: T | undefined, next: T): boolean {
  return JSON.stringify(prev) !== JSON.stringify(next);
}
