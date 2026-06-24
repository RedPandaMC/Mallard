/**
 * Holt-Winters triple exponential smoothing with additive weekly seasonality (m=7).
 *
 * Parameters (alpha, beta, gamma) are fitted by coarse grid-search minimising
 * mean squared one-step-ahead error.  Requires ≥ 14 observations; the caller
 * (`selectForecaster`) guarantees this.
 *
 * The MLOps caching layer (store fitted params in the DuckDB `meta` table, key
 * `forecaster.seasonal.v1`) is deliberately left at the service boundary — call
 * `fitHoltWinters` from `UsageService.buildSnapshot()` when params are stale and
 * persist the JSON.  This file remains a pure domain module with no I/O.
 */
import type { Forecast } from '../types';
import type { Forecaster, ForecastInput } from './linear';
import { DAY_MS, startOf, nextBucketStart } from '../../util/time';

export interface HoltWintersParams {
  alpha: number;
  beta: number;
  gamma: number;
  /** 7 seasonal index values (one per weekday position in the cycle). */
  seasonalIndices: number[];
  /** Akaike Information Criterion for model comparison. */
  aic: number;
  fittedAt: number;
}

const PERIOD = 7; // weekly seasonality

/**
 * Mean squared one-step-ahead forecast error for given Holt-Winters params.
 * Uses the first `PERIOD` observations only for initialisation.
 */
function hwMse(series: number[], alpha: number, beta: number, gamma: number): number {
  const m = PERIOD;
  const n = series.length;
  if (n <= m) return Infinity;

  /* c8 ignore next */
  const initAvg = series.slice(0, m).reduce((a, b) => a + b, 0) / m || 1;
  let L = initAvg;
  let B = 0;
  const S = series.slice(0, m).map((v) => v - initAvg);

  let totalSE = 0;
  const count = n - m;
  for (let t = m; t < n; t++) {
    const y = series[t]!;
    const si = S[t % m]!;
    const yHat = Math.max(0, L + B + si);
    totalSE += (y - yHat) ** 2;
    const prevL = L;
    L = alpha * (y - si) + (1 - alpha) * (L + B);
    B = beta * (L - prevL) + (1 - beta) * B;
    S[t % m] = gamma * (y - L) + (1 - gamma) * si;
  }
  return totalSE / count;
}

/**
 * Replay Holt-Winters on the series and return the final state (L, B, S[]).
 * S[] has length PERIOD — the current seasonal indices after processing all data.
 */
function hwState(
  series: number[],
  alpha: number,
  beta: number,
  gamma: number,
): { L: number; B: number; S: number[]; residualStd: number } {
  const m = PERIOD;
  const n = series.length;
  /* c8 ignore next */
  const initAvg = series.slice(0, Math.min(m, n)).reduce((a, b) => a + b, 0) / Math.min(m, n) || 1;
  let L = initAvg;
  let B = 0;
  const S = series.slice(0, Math.min(m, n)).map((v) => v - initAvg);
  while (S.length < m) S.push(0);

  let sse = 0;
  let count = 0;
  for (let t = 0; t < n; t++) {
    const y = series[t]!;
    const si = S[t % m]!;
    if (t >= m) {
      sse += (y - Math.max(0, L + B + si)) ** 2;
      count++;
    }
    const prevL = L;
    L = alpha * (y - si) + (1 - alpha) * (L + B);
    B = beta * (L - prevL) + (1 - beta) * B;
    S[t % m] = gamma * (y - L) + (1 - gamma) * si;
  }
  return { L, B, S: [...S], residualStd: Math.sqrt(count > 0 ? sse / count : 0) };
}

/**
 * Fit Holt-Winters parameters by coarse grid-search over [0.1, 0.9] in steps
 * of 0.1 for alpha, beta, and gamma.  Returns the best-fitting params.
 */
export function fitHoltWinters(series: number[]): HoltWintersParams {
  const m = PERIOD;
  const STEPS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

  let bestAlpha = 0.3;
  let bestBeta = 0.1;
  let bestGamma = 0.2;
  let bestMse = Infinity;

  for (const alpha of STEPS) {
    for (const beta of STEPS) {
      for (const gamma of STEPS) {
        const mse = hwMse(series, alpha, beta, gamma);
        if (mse < bestMse) {
          bestMse = mse;
          bestAlpha = alpha;
          bestBeta = beta;
          bestGamma = gamma;
        }
      }
    }
  }

  const { S } = hwState(series, bestAlpha, bestBeta, bestGamma);

  // AIC: n * ln(MSE) + 2 * k, k = 3 params + m seasonal indices
  const n = Math.max(1, series.length - m);
  const aic = n * Math.log(Math.max(1e-10, bestMse)) + 2 * (3 + m);

  return {
    alpha: bestAlpha,
    beta: bestBeta,
    gamma: bestGamma,
    seasonalIndices: S,
    aic,
    fittedAt: Date.now(),
  };
}

export const seasonalForecaster: Forecaster = {
  forecast({ dayAggregates, now, pricePerCredit }: ForecastInput): Forecast {
    const monthStart = startOf(now, 'month');
    const monthEnd = nextBucketStart(now, 'month');
    const totalDays = Math.round((monthEnd - monthStart) / DAY_MS);
    const elapsedDays = Math.min(totalDays, Math.floor((now - monthStart) / DAY_MS) + 1);
    const remainingDays = Math.max(0, totalDays - elapsedDays);

    const monthDays = dayAggregates.filter((a) => a.start >= monthStart && a.start < monthEnd);
    const mtdCredits = monthDays.reduce((s, a) => s + a.credits, 0);
    const asOf = now;

    // Build the full daily credit series (all available history, sorted)
    const sorted = [...dayAggregates].sort((a, b) => a.start - b.start);
    const series = sorted.map((a) => a.credits);

    const params = fitHoltWinters(series);
    const { L, B, S, residualStd } = hwState(series, params.alpha, params.beta, params.gamma);

    // Project remaining days of the month
    let forecastedRemaining = 0;
    for (let h = 1; h <= remainingDays; h++) {
      forecastedRemaining += Math.max(0, L + h * B + S[(series.length + h - 1) % PERIOD]!);
    }

    const projectedCredits = mtdCredits + forecastedRemaining;
    const band = residualStd * Math.sqrt(Math.max(1, remainingDays));

    return {
      granularity: 'month',
      projectedCredits,
      projectedCost: projectedCredits * pricePerCredit,
      low: Math.max(mtdCredits, projectedCredits - band),
      high: projectedCredits + band,
      basis: 'seasonal',
      asOf,
    };
  },
/* c8 ignore next */
};
