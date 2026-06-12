/**
 * Pure month-end forecasting from daily aggregates.
 *
 * Primary model: linear run-rate. The confidence band widens with the number
 * of remaining days (uncertainty compounds) and never dips below the
 * month-to-date total.
 */
import { Forecast, UsageAggregate } from './types';
import { DAY_MS, nextBucketStart, startOf } from '../util/time';

export function forecastMonth(
  dayAggregates: UsageAggregate[],
  now: number,
  pricePerCredit: number,
): Forecast {
  const monthStart = startOf(now, 'month');
  const monthEnd = nextBucketStart(now, 'month');
  const totalDays = Math.round((monthEnd - monthStart) / DAY_MS);
  const elapsedDays = Math.min(totalDays, Math.floor((now - monthStart) / DAY_MS) + 1);
  const remainingDays = Math.max(0, totalDays - elapsedDays);

  const monthDays = dayAggregates.filter((a) => a.start >= monthStart && a.start < monthEnd);
  const mtdCredits = monthDays.reduce((s, a) => s + a.credits, 0);
  const activeDays = monthDays.filter((a) => a.credits > 0).length;
  const asOf = now;

  if (activeDays < 3 || elapsedDays <= 0) {
    return {
      granularity: 'month',
      projectedCredits: mtdCredits,
      projectedCost: mtdCredits * pricePerCredit,
      low: mtdCredits,
      high: mtdCredits,
      basis: 'insufficient-data',
      asOf,
    };
  }

  const dailyRate = mtdCredits / elapsedDays;
  const projectedCredits = mtdCredits + dailyRate * remainingDays;

  // Per-day totals across the elapsed window (zero-filled) for variance.
  const byDayStart = new Map<number, number>();
  for (const a of monthDays) byDayStart.set(a.start, a.credits);
  const dailyTotals: number[] = [];
  for (let i = 0; i < elapsedDays; i++) {
    const dayStart = startOf(monthStart + i * DAY_MS + DAY_MS / 2, 'day');
    dailyTotals.push(byDayStart.get(dayStart) ?? 0);
  }
  const variance =
    dailyTotals.reduce((s, v) => s + (v - dailyRate) ** 2, 0) / Math.max(1, dailyTotals.length);
  const stdev = Math.sqrt(variance);
  const band = stdev * Math.sqrt(remainingDays);

  const low = Math.max(mtdCredits, projectedCredits - band);
  const high = projectedCredits + band;

  return {
    granularity: 'month',
    projectedCredits,
    projectedCost: projectedCredits * pricePerCredit,
    low,
    high,
    basis: 'linear',
    asOf,
  };
}
