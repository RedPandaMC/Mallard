/**
 * Month-end forecasting. The default model is a linear run-rate; the
 * {@link Forecaster} seam lets a richer model (e.g. a seasonal fit) drop in
 * later without touching callers.
 */
import { Forecast, UsageAggregate } from './types';
import { Forecaster, linearForecaster } from './forecasters/linear';

export type { Forecaster, ForecastInput } from './forecasters/linear';

/** The forecaster used to build snapshots. Swap here to change the model. */
export const defaultForecaster: Forecaster = linearForecaster;

export function forecastMonth(
  dayAggregates: UsageAggregate[],
  now: number,
  pricePerCredit: number,
): Forecast {
  return defaultForecaster.forecast({ dayAggregates, now, pricePerCredit });
}
