import { strict as assert } from 'assert';
import { aggregateBy } from '../../src/domain/aggregate';
import { forecastMonth } from '../../src/domain/forecast';
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
