import { strict as assert } from 'assert';
import {
  aggregateAll,
  aggregateBy,
  sankeyLinksFor,
  sumEvents,
  topBy,
} from '../../src/domain/aggregate';
import { makeEvent } from './helpers';

describe('aggregate', () => {
  const d1 = new Date(2026, 5, 10, 9).getTime();
  const d1b = new Date(2026, 5, 10, 15).getTime();
  const d2 = new Date(2026, 5, 11, 9).getTime();

  const events = [
    makeEvent({ ts: d1, credits: 2, cost: 0.08, modelId: 'gpt-4o', surface: 'chat' }),
    makeEvent({ ts: d1b, credits: 1, cost: 0.04, modelId: 'claude-sonnet-4', surface: 'inline' }),
    makeEvent({ ts: d2, credits: 3, cost: 0.12, modelId: 'gpt-4o', surface: 'agent' }),
  ];

  it('buckets by day and sums credits/cost', () => {
    const days = aggregateBy(events, 'day');
    assert.equal(days.length, 2);
    assert.equal(days[0]!.bucketKey, '2026-06-10');
    assert.equal(days[0]!.credits, 3);
    assert.ok(Math.abs(days[0]!.cost - 0.12) < 1e-9);
    assert.equal(days[0]!.eventCount, 2);
  });

  it('breaks down by model', () => {
    const days = aggregateBy(events, 'day');
    assert.equal(days[0]!.byModel['gpt-4o']!.credits, 2);
    assert.equal(days[0]!.byModel['claude-sonnet-4']!.credits, 1);
  });

  it('produces day, week, month granularities', () => {
    const all = aggregateAll(events);
    assert.deepEqual(Object.keys(all).sort(), ['day', 'month', 'week']);
    assert.equal(all.month[0]!.credits, 6);
  });

  it('applies a model filter', () => {
    const days = aggregateBy(events, 'day', { models: ['gpt-4o'] });
    const total = days.reduce((s, a) => s + a.credits, 0);
    assert.equal(total, 5);
  });

  it('applies a surface filter', () => {
    const days = aggregateBy(events, 'day', { surfaces: ['chat'] });
    const total = days.reduce((s, a) => s + a.credits, 0);
    assert.equal(total, 2);
  });

  it('ranks top models by credits', () => {
    const top = topBy(events, 'model');
    assert.equal(top[0]!.key, 'gpt-4o');
    assert.equal(top[0]!.credits, 5);
  });

  it('builds sankey links', () => {
    const links = sankeyLinksFor(events);
    const chat = links.find((l) => l.source === 'gpt-4o' && l.target === 'chat');
    assert.ok(chat, 'should have gpt-4o → chat link');
    assert.equal(chat!.value, 2);
  });

  it('handles empty input', () => {
    assert.deepEqual(aggregateBy([], 'day'), []);
    assert.deepEqual(sumEvents([]), { credits: 0, cost: 0, tokens: 0, count: 0 });
  });
});
