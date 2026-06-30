import { strict as assert } from 'assert';
import { aggregateBy } from '../../../src/extension-backend/domain/aggregate';
import { fitHoltWinters, seasonalForecaster } from '../../../src/extension-backend/domain/forecasters/seasonal';
import { startOf, nextBucketStart, DAY_MS } from '../../../src/extension-backend/util/time';
import { makeEvent } from '../helpers';

describe('fitHoltWinters', () => {
  it('handles short series (< PERIOD=7): all MSEs are Infinity, still returns params', () => {
    const params = fitHoltWinters([1, 2, 3]);
    assert.ok(typeof params.alpha === 'number');
    assert.ok(typeof params.beta === 'number');
    assert.ok(typeof params.gamma === 'number');
    assert.equal(params.seasonalIndices.length, 7);
    // With a 3-element series, hwMse always returns Infinity → bestMse stays Infinity
    // AIC = n * log(Infinity) + 2*(3+7) → Infinity
    assert.ok(!isFinite(params.aic));
    assert.ok(params.fittedAt > 0);
  });

  it('handles a series of exactly PERIOD length (boundary)', () => {
    const params = fitHoltWinters([1, 2, 3, 4, 5, 6, 7]);
    assert.equal(params.seasonalIndices.length, 7);
    // n <= m for all grid points → Infinity MSE
    assert.ok(!isFinite(params.aic));
  });

  it('returns valid params for a full seasonal series', () => {
    const series = Array.from({ length: 21 }, (_, i) => 10 + (i % 7 < 5 ? 5 : 0));
    const params = fitHoltWinters(series);
    assert.ok(params.alpha > 0 && params.alpha <= 1);
    assert.ok(params.beta > 0 && params.beta <= 1);
    assert.ok(params.gamma > 0 && params.gamma <= 1);
    assert.equal(params.seasonalIndices.length, 7);
    assert.ok(isFinite(params.aic));
  });
});

describe('seasonalForecaster', () => {
  it('returns a seasonal basis for 14+ days of data', () => {
    const now = new Date(2026, 5, 20, 12).getTime();
    const monthStart = startOf(now, 'month');
    const events = Array.from({ length: 14 }, (_, d) =>
      makeEvent({ id: `d${d}`, ts: monthStart + d * DAY_MS + DAY_MS / 2, credits: 10 + (d % 3) }),
    );
    const dayAggregates = aggregateBy(events, 'day');
    const f = seasonalForecaster.forecast({ dayAggregates, now, pricePerCredit: 0.04 });
    assert.equal(f.basis, 'seasonal');
    assert.ok(f.projectedCredits > 0);
    assert.ok(f.low <= f.projectedCredits);
    assert.ok(f.high >= f.projectedCredits);
  });

  it('projectedCredits equals mtdCredits when remainingDays is 0', () => {
    // Place now at the last day of the month so remainingDays = 0
    const now = new Date(2026, 5, 30, 23, 30).getTime(); // June 30
    const monthStart = startOf(now, 'month');
    const monthEnd = nextBucketStart(now, 'month');
    const totalDays = Math.round((monthEnd - monthStart) / DAY_MS);
    const events = Array.from({ length: totalDays }, (_, d) =>
      makeEvent({ id: `d${d}`, ts: monthStart + d * DAY_MS + DAY_MS / 2, credits: 10 }),
    );
    const dayAggregates = aggregateBy(events, 'day');
    const mtdCredits = dayAggregates
      .filter((a) => a.start >= monthStart && a.start < monthEnd)
      .reduce((s, a) => s + a.credits, 0);
    const f = seasonalForecaster.forecast({ dayAggregates, now, pricePerCredit: 0.04 });
    // forecastedRemaining loop doesn't execute → projectedCredits = mtdCredits
    assert.ok(Math.abs(f.projectedCredits - mtdCredits) < 1e-6);
  });

  it('low is clamped to mtdCredits', () => {
    const now = new Date(2026, 5, 20, 12).getTime();
    const monthStart = startOf(now, 'month');
    const events = Array.from({ length: 14 }, (_, d) =>
      makeEvent({ id: `d${d}`, ts: monthStart + d * DAY_MS + DAY_MS / 2, credits: 10 }),
    );
    const dayAggregates = aggregateBy(events, 'day');
    const mtdCredits = dayAggregates
      .filter((a) => a.start >= monthStart && a.start < nextBucketStart(now, 'month'))
      .reduce((s, a) => s + a.credits, 0);
    const f = seasonalForecaster.forecast({ dayAggregates, now, pricePerCredit: 0.04 });
    assert.ok(f.low >= mtdCredits - 1e-6, `low (${f.low}) must be >= mtdCredits (${mtdCredits})`);
  });

  it('applies pricePerCredit to projectedCost', () => {
    const now = new Date(2026, 5, 20, 12).getTime();
    const monthStart = startOf(now, 'month');
    const events = Array.from({ length: 14 }, (_, d) =>
      makeEvent({ id: `d${d}`, ts: monthStart + d * DAY_MS + DAY_MS / 2, credits: 10 }),
    );
    const dayAggregates = aggregateBy(events, 'day');
    const f = seasonalForecaster.forecast({ dayAggregates, now, pricePerCredit: 0.05 });
    assert.ok(Math.abs(f.projectedCost - f.projectedCredits * 0.05) < 1e-6);
  });
});
