import { strict as assert } from 'assert';
import { aggregateAll, aggregateBy, sumEvents, topBy } from '../../src/model/aggregate';
import { makeEvent } from './helpers';

describe('aggregate', () => {
  const d1 = new Date(2026, 5, 10, 9).getTime();
  const d1b = new Date(2026, 5, 10, 15).getTime();
  const d2 = new Date(2026, 5, 11, 9).getTime();

  const events = [
    makeEvent({ ts: d1, credits: 2, cost: 0.08, modelId: 'gpt-4o', repo: 'alpha' }),
    makeEvent({ ts: d1b, credits: 1, cost: 0.04, modelId: 'claude-sonnet-4', repo: 'beta' }),
    makeEvent({ ts: d2, credits: 3, cost: 0.12, modelId: 'gpt-4o', repo: 'alpha' }),
  ];

  it('buckets by day and sums credits/cost', () => {
    const days = aggregateBy(events, 'day');
    assert.equal(days.length, 2);
    assert.equal(days[0].bucketKey, '2026-06-10');
    assert.equal(days[0].credits, 3);
    assert.ok(Math.abs(days[0].cost - 0.12) < 1e-9);
    assert.equal(days[0].eventCount, 2);
  });

  it('breaks down by model and repo', () => {
    const days = aggregateBy(events, 'day');
    assert.equal(days[0].byModel['gpt-4o'].credits, 2);
    assert.equal(days[0].byModel['claude-sonnet-4'].credits, 1);
    assert.equal(days[0].byRepo['alpha'].credits, 2);
    assert.equal(days[0].byRepo['beta'].credits, 1);
  });

  it('produces all six granularities', () => {
    const all = aggregateAll(events);
    assert.deepEqual(Object.keys(all).sort(), [
      'day',
      'hour',
      'month',
      'quarter',
      'week',
      'year',
    ]);
    assert.equal(all.month[0].credits, 6);
    assert.equal(all.year[0].credits, 6);
  });

  it('applies a repo filter', () => {
    const days = aggregateBy(events, 'day', { repos: ['alpha'] });
    const total = days.reduce((s, a) => s + a.credits, 0);
    assert.equal(total, 5);
  });

  it('ranks top models by credits', () => {
    const top = topBy(events, 'model');
    assert.equal(top[0].key, 'gpt-4o');
    assert.equal(top[0].credits, 5);
  });

  it('handles empty input', () => {
    assert.deepEqual(aggregateBy([], 'day'), []);
    assert.deepEqual(sumEvents([]), { credits: 0, cost: 0, tokens: 0, count: 0 });
  });
});
