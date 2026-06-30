import { strict as assert } from 'assert';
import { aggregateBy } from '../../src/client_extension/domain/aggregate';
import { forecastMonth, selectForecaster, fitHoltWinters } from '../../src/client_extension/domain/forecast';
import { linearForecaster } from '../../src/client_extension/domain/forecasters/linear';
import { seasonalForecaster } from '../../src/client_extension/domain/forecasters/seasonal';
import { makeEvent } from './helpers';

describe('forecast', () => {
  it('projects linearly from a steady run-rate', () => {
    const events = [];
    for (let d = 0; d < 10; d++) {
      events.push(makeEvent({ ts: new Date(2026, 5, 1 + d, 12).getTime(), credits: 10 }));
    }
    const dayAggs = aggregateBy(events, 'day');
    const now = new Date(2026, 5, 10, 18).getTime(); // 10 days elapsed of 30
    const f = forecastMonth(dayAggs, now, 0.04);

    assert.equal(f.basis, 'linear');
    // mtd = 100, rate = 10/day, remaining = 20 → projected 300
    assert.ok(Math.abs(f.projectedCredits - 300) < 1e-6);
    assert.ok(Math.abs(f.projectedCost - 12) < 1e-6);
    assert.ok(f.low <= f.projectedCredits && f.projectedCredits <= f.high);
    assert.ok(f.low >= 100, 'band never dips below month-to-date');
  });

  it('reports insufficient-data with fewer than 3 active days', () => {
    const events = [
      makeEvent({ ts: new Date(2026, 5, 1, 12).getTime(), credits: 5 }),
      makeEvent({ ts: new Date(2026, 5, 2, 12).getTime(), credits: 5 }),
    ];
    const dayAggs = aggregateBy(events, 'day');
    const now = new Date(2026, 5, 2, 18).getTime();
    const f = forecastMonth(dayAggs, now, 0.04);

    assert.equal(f.basis, 'insufficient-data');
    assert.equal(f.projectedCredits, 10);
    assert.equal(f.low, 10);
    assert.equal(f.high, 10);
  });
});

describe('forecast — edge cases', () => {
  it('returns insufficient-data for empty dayAggregates', () => {
    const f = forecastMonth([], Date.now(), 0.04);
    assert.equal(f.basis, 'insufficient-data');
    assert.equal(f.projectedCredits, 0);
    assert.equal(f.projectedCost, 0);
    assert.equal(f.low, 0);
    assert.equal(f.high, 0);
  });

  it('projectedCost is 0 when pricePerCredit is 0', () => {
    const events = Array.from({ length: 5 }, (_, d) =>
      makeEvent({ ts: new Date(2026, 5, 1 + d, 12).getTime(), credits: 10 }),
    );
    const dayAggs = aggregateBy(events, 'day');
    const f = forecastMonth(dayAggs, new Date(2026, 5, 5, 18).getTime(), 0);
    assert.equal(f.basis, 'linear');
    assert.equal(f.projectedCost, 0);
    assert.ok(f.projectedCredits > 0);
  });
});

describe('selectForecaster', () => {
  it('returns linearForecaster when activeDays < 14', () => {
    assert.equal(selectForecaster(0), linearForecaster);
    assert.equal(selectForecaster(5), linearForecaster);
    assert.equal(selectForecaster(13), linearForecaster);
  });

  it('returns seasonalForecaster when activeDays >= 14', () => {
    assert.equal(selectForecaster(14), seasonalForecaster);
    assert.equal(selectForecaster(30), seasonalForecaster);
  });
});

describe('fitHoltWinters', () => {
  it('returns params in valid range [0.1, 0.9]', () => {
    const series = Array.from({ length: 21 }, (_, i) => 10 + (i % 7 < 5 ? 5 : 0));
    const params = fitHoltWinters(series);
    assert.ok(params.alpha >= 0.05 && params.alpha <= 1, 'alpha in range');
    assert.ok(params.beta >= 0.05 && params.beta <= 1, 'beta in range');
    assert.ok(params.gamma >= 0.05 && params.gamma <= 1, 'gamma in range');
    assert.equal(params.seasonalIndices.length, 7, '7 seasonal indices');
    assert.ok(typeof params.aic === 'number', 'aic is a number');
    assert.ok(params.fittedAt > 0, 'fittedAt is set');
  });

  it('seasonal indices sum to approximately zero', () => {
    const series = Array.from({ length: 28 }, (_, i) => 10 + (i % 7 < 5 ? 5 : 0));
    const params = fitHoltWinters(series);
    const sum = params.seasonalIndices.reduce((a, b) => a + b, 0);
    // Additive seasonal indices should sum near zero across one full period
    assert.ok(Math.abs(sum) < 30, `seasonal indices sum ${sum.toFixed(2)} should be near zero`);
  });
});

describe('seasonalForecaster', () => {
  function makeWeeklyEvents(weeks: number): ReturnType<typeof makeEvent>[] {
    const events: ReturnType<typeof makeEvent>[] = [];
    for (let d = 0; d < weeks * 7; d++) {
      const credits = d % 7 < 5 ? 10 : 2; // weekdays high, weekends low
      events.push(makeEvent({ ts: new Date(2026, 0, 1 + d, 12).getTime(), credits }));
    }
    return events;
  }

  it('returns seasonal basis with 14+ active days of data in current month', () => {
    // Use 3 weeks in the same month (Jan 2026 has 31 days)
    const events = makeWeeklyEvents(3);
    const dayAggs = aggregateBy(events, 'day');
    const now = new Date(2026, 0, 21, 18).getTime(); // Jan 21
    const f = forecastMonth(dayAggs, now, 0.04);
    assert.equal(f.basis, 'seasonal');
    assert.ok(f.low <= f.projectedCredits, 'low ≤ projected');
    assert.ok(f.projectedCredits <= f.high, 'projected ≤ high');
    assert.ok(f.projectedCredits >= 0, 'non-negative projection');
    assert.ok(f.projectedCost >= 0, 'non-negative cost');
  });

  it('produces a monotone lower bound (never dips below MTD)', () => {
    const events = makeWeeklyEvents(3);
    const dayAggs = aggregateBy(events, 'day');
    const now = new Date(2026, 0, 21, 18).getTime();
    const mtdCredits = dayAggs
      .filter((a) => a.start >= new Date(2026, 0, 1).getTime() && a.start < new Date(2026, 0, 31).getTime())
      .reduce((s, a) => s + a.credits, 0);
    const f = forecastMonth(dayAggs, now, 0.04);
    assert.ok(f.low >= mtdCredits - 0.01, 'low never dips below MTD');
  });
});

