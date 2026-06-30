import { strict as assert } from 'assert';
import { aggregateBy } from '../../../src/extension/domain/aggregate';
import { linearForecaster } from '../../../src/extension/domain/forecasters/linear';
import { startOf, nextBucketStart, DAY_MS } from '../../../src/extension/util/time';
import { makeEvent } from '../helpers';

function makeDayEvents(dayOffsets: number[], creditsPerDay: number, monthStart: number) {
  return dayOffsets.map((d, i) =>
    makeEvent({ id: `d${d}-${i}`, ts: monthStart + d * DAY_MS + DAY_MS / 2, credits: creditsPerDay }),
  );
}

describe('linearForecaster', () => {
  it('returns insufficient-data when activeDays < 3', () => {
    const now = new Date(2026, 5, 10, 12).getTime();
    const monthStart = startOf(now, 'month');
    const events = [
      makeEvent({ id: 'a', ts: monthStart + DAY_MS / 2, credits: 5 }),
      makeEvent({ id: 'b', ts: monthStart + DAY_MS + DAY_MS / 2, credits: 5 }),
    ];
    const dayAggregates = aggregateBy(events, 'day');
    const f = linearForecaster.forecast({ dayAggregates, now, pricePerCredit: 0.04 });
    assert.equal(f.basis, 'insufficient-data');
    assert.equal(f.projectedCredits, 10);
    assert.equal(f.low, 10);
    assert.equal(f.high, 10);
  });

  it('returns insufficient-data when elapsedDays <= 0 (now before monthStart)', () => {
    const now = new Date(2026, 5, 1).getTime();
    // monthStart at midnight on June 1 — elapsedDays = floor((0)/DAY_MS)+1 = 1 normally,
    // so use a now that is literally before the month boundary
    const monthStart = startOf(now, 'month');
    const beforeMonth = monthStart - 1;
    // Provide 3+ active days from a prior window so activeDays check passes if reached,
    // but elapsedDays <= 0 fires first when monthDays is empty
    const f = linearForecaster.forecast({ dayAggregates: [], now: beforeMonth, pricePerCredit: 0.04 });
    assert.equal(f.basis, 'insufficient-data');
  });

  it('produces zero band at end of month (remainingDays = 0)', () => {
    const now = new Date(2026, 5, 30, 23, 0).getTime(); // last day of June 2026
    const monthStart = startOf(now, 'month');
    const monthEnd = nextBucketStart(now, 'month');
    const totalDays = Math.round((monthEnd - monthStart) / DAY_MS);
    // Events on days 0..totalDays-1
    const events = Array.from({ length: totalDays }, (_, d) =>
      makeEvent({ id: `d${d}`, ts: monthStart + d * DAY_MS + DAY_MS / 2, credits: 10 }),
    );
    const dayAggregates = aggregateBy(events, 'day');
    const f = linearForecaster.forecast({ dayAggregates, now, pricePerCredit: 0.04 });
    assert.equal(f.basis, 'linear');
    // band = stdev * sqrt(0) = 0, so low = high = projected
    assert.ok(Math.abs(f.high - f.low) < 1e-6, `low (${f.low}) should equal high (${f.high})`);
  });

  it('zero-fills missing days in variance calculation', () => {
    const now = new Date(2026, 5, 10, 12).getTime();
    const monthStart = startOf(now, 'month');
    // Only 3 active days spread non-consecutively (gaps get zero-filled)
    const events = [
      makeEvent({ id: 'a', ts: monthStart + 0 * DAY_MS + DAY_MS / 2, credits: 10 }),
      makeEvent({ id: 'b', ts: monthStart + 4 * DAY_MS + DAY_MS / 2, credits: 10 }),
      makeEvent({ id: 'c', ts: monthStart + 8 * DAY_MS + DAY_MS / 2, credits: 10 }),
    ];
    const dayAggregates = aggregateBy(events, 'day');
    const f = linearForecaster.forecast({ dayAggregates, now, pricePerCredit: 0.04 });
    assert.equal(f.basis, 'linear');
    // With gaps, variance is non-zero → band > 0 → high > low
    assert.ok(f.high > f.low, 'band should be positive with zero-filled gaps');
  });

  it('low is clamped to mtdCredits when projected - band < mtdCredits', () => {
    const now = new Date(2026, 5, 5, 12).getTime();
    const monthStart = startOf(now, 'month');
    // High variance: days 0,1,2 have wildly different credits → band can exceed remaining projection
    const events = [
      makeEvent({ id: 'a', ts: monthStart + 0 * DAY_MS + DAY_MS / 2, credits: 0.01 }),
      makeEvent({ id: 'b', ts: monthStart + 1 * DAY_MS + DAY_MS / 2, credits: 1000 }),
      makeEvent({ id: 'c', ts: monthStart + 2 * DAY_MS + DAY_MS / 2, credits: 0.01 }),
    ];
    const dayAggregates = aggregateBy(events, 'day');
    const mtdCredits = 1000.02;
    const f = linearForecaster.forecast({ dayAggregates, now, pricePerCredit: 0.04 });
    assert.equal(f.basis, 'linear');
    assert.ok(f.low >= mtdCredits - 1e-6, `low (${f.low}) should be >= mtdCredits (${mtdCredits})`);
  });

  it('projects cost using pricePerCredit', () => {
    const now = new Date(2026, 5, 10, 12).getTime();
    const monthStart = startOf(now, 'month');
    const events = makeDayEvents([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 10, monthStart);
    const dayAggregates = aggregateBy(events, 'day');
    const f = linearForecaster.forecast({ dayAggregates, now, pricePerCredit: 0.05 });
    assert.ok(Math.abs(f.projectedCost - f.projectedCredits * 0.05) < 1e-6);
  });
});
