/* c8 ignore next */
/**
 * Month-end forecasting. The default model is a linear run-rate; the
 * {@link Forecaster} seam lets a richer model (seasonal Holt-Winters) drop in
 * automatically when enough data is available.
 *
 * Model selection:
 *   < 3 active days  → insufficient-data (linear returns the MTD total as-is)
 *   3–13 active days → linear run-rate
 *   ≥ 14 active days → Holt-Winters (additive weekly seasonality)
 */
import { Forecast, UsageAggregate } from './types';
import { Forecaster, linearForecaster } from './forecasters/linear';
import { seasonalForecaster } from './forecasters/seasonal';

export type { Forecaster, ForecastInput } from './forecasters/linear';
export type { HoltWintersParams } from './forecasters/seasonal';
export { fitHoltWinters } from './forecasters/seasonal';

const SEASONAL_THRESHOLD = 14;

/**
 * Selects the appropriate forecasting model based on the number of active days
 * with non-zero usage.
 *
 * Exposed so callers (e.g. UsageService) can determine which model will be used
 * and decide whether to pre-fit and cache seasonal parameters.
 */
export function selectForecaster(activeDays: number): Forecaster {
  if (activeDays < SEASONAL_THRESHOLD) return linearForecaster;
  return seasonalForecaster;
}

/** The fallback forecaster; kept for API compatibility. */
export const defaultForecaster: Forecaster = linearForecaster;

/* c8 ignore next */
export function forecastMonth(
  dayAggregates: UsageAggregate[],
  now: number,
  pricePerCredit: number,
): Forecast {
  const activeDays = dayAggregates.filter((a) => a.credits > 0).length;
  const forecaster = selectForecaster(activeDays);
  return forecaster.forecast({ dayAggregates, now, pricePerCredit });
}
