import { strict as assert } from 'assert';
import { addCategories, rollupEvents } from '../../src/domain/rollup';
import { startOf } from '../../src/util/time';
import { makeEvent } from './helpers';

// ── addCategories ─────────────────────────────────────────────────────────────

describe('addCategories', () => {
  it('both undefined → undefined', () => {
    assert.equal(addCategories(undefined, undefined), undefined);
  });

  it('a defined, b undefined → returns copy of a', () => {
    const result = addCategories({ input: 1.5 }, undefined);
    assert.deepEqual(result, { input: 1.5 });
  });

  it('a undefined, b defined → returns copy of b', () => {
    const result = addCategories(undefined, { output: 2.0 });
    assert.deepEqual(result, { output: 2.0 });
  });

  it('both defined, disjoint keys → all keys present', () => {
    const result = addCategories({ input: 1 }, { output: 2 });
    assert.deepEqual(result, { input: 1, output: 2 });
  });

  it('both defined, overlapping key → value is sum', () => {
    const result = addCategories({ input: 3, cache_read: 1 }, { input: 2, output: 5 });
    assert.deepEqual(result, { input: 5, cache_read: 1, output: 5 });
  });
});

// ── rollupEvents ──────────────────────────────────────────────────────────────

describe('rollupEvents', () => {
  it('empty array → []', () => {
    assert.deepEqual(rollupEvents([]), []);
  });

  it('single event → one row with id="roll:...", estimated=true, ts=startOf(e.ts,"day")', () => {
    const ts = Date.now();
    const e = makeEvent({ ts, modelId: 'gpt-4o', credits: 5, repo: 'my-repo' });
    const result = rollupEvents([e]);
    assert.equal(result.length, 1);
    assert.ok(result[0]!.id.startsWith('roll:'));
    assert.equal(result[0]!.estimated, true);
    assert.equal(result[0]!.ts, startOf(ts, 'day'));
  });

  it('two events same day/model/repo/surface → one merged row (credits, cost, tokens summed)', () => {
    const ts = Date.now();
    const day = startOf(ts, 'day');
    const e1 = makeEvent({ ts: day + 1000, modelId: 'gpt-4o', credits: 3, cost: 0.12, promptTokens: 100, completionTokens: 50, repo: 'repo-a' });
    const e2 = makeEvent({ ts: day + 2000, modelId: 'gpt-4o', credits: 2, cost: 0.08, promptTokens: 80, completionTokens: 30, repo: 'repo-a' });
    const result = rollupEvents([e1, e2]);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.credits, 5);
    assert.ok(Math.abs(result[0]!.cost - 0.20) < 0.0001);
    assert.equal(result[0]!.promptTokens, 180);
    assert.equal(result[0]!.completionTokens, 80);
  });

  it('two events different days → two rows sorted by ts', () => {
    const now = Date.now();
    const day1 = startOf(now - 86_400_000, 'day');
    const day2 = startOf(now, 'day');
    const e1 = makeEvent({ ts: day1 + 1000, modelId: 'gpt-4o', credits: 1 });
    const e2 = makeEvent({ ts: day2 + 1000, modelId: 'gpt-4o', credits: 2 });
    const result = rollupEvents([e1, e2]);
    assert.equal(result.length, 2);
    assert.ok(result[0]!.ts <= result[1]!.ts);
  });

  it('two events same day, different models → two rows', () => {
    const ts = startOf(Date.now(), 'day') + 1000;
    const e1 = makeEvent({ ts, modelId: 'gpt-4o', credits: 1 });
    const e2 = makeEvent({ ts, modelId: 'claude-3-opus', credits: 2 });
    const result = rollupEvents([e1, e2]);
    assert.equal(result.length, 2);
  });

  it('two events same day, different surfaces → two rows', () => {
    const ts = startOf(Date.now(), 'day') + 1000;
    const e1 = makeEvent({ ts, modelId: 'gpt-4o', surface: 'chat', credits: 1 });
    const e2 = makeEvent({ ts, modelId: 'gpt-4o', surface: 'inline', credits: 2 });
    const result = rollupEvents([e1, e2]);
    assert.equal(result.length, 2);
  });

  it('events with costByCategory → categories merged', () => {
    const ts = startOf(Date.now(), 'day') + 1000;
    const e1 = makeEvent({ ts, modelId: 'gpt-4o', credits: 2, costByCategory: { input: 1.0 } });
    const e2 = makeEvent({ ts, modelId: 'gpt-4o', credits: 3, costByCategory: { input: 0.5, output: 2.0 } });
    const result = rollupEvents([e1, e2]);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0]!.costByCategory, { input: 1.5, output: 2.0 });
  });

  it('event with null repo → UNATTRIBUTED_REPO in key (still rolls up)', () => {
    const ts = startOf(Date.now(), 'day') + 1000;
    const e1 = makeEvent({ ts, modelId: 'gpt-4o', credits: 1 });
    const e2 = makeEvent({ ts, modelId: 'gpt-4o', credits: 2 });
    const result = rollupEvents([e1, e2]);
    assert.equal(result.length, 1);
    assert.ok(result[0]!.id.includes('unattributed'));
    assert.equal(result[0]!.credits, 3);
  });

  it('output sorted ascending by ts', () => {
    const day1 = startOf(Date.now() - 2 * 86_400_000, 'day');
    const day2 = startOf(Date.now() - 1 * 86_400_000, 'day');
    const day3 = startOf(Date.now(), 'day');
    const e3 = makeEvent({ ts: day3 + 100, modelId: 'gpt-4o', credits: 1 });
    const e1 = makeEvent({ ts: day1 + 100, modelId: 'gpt-4o', credits: 1 });
    const e2 = makeEvent({ ts: day2 + 100, modelId: 'gpt-4o', credits: 1 });
    const result = rollupEvents([e3, e1, e2]);
    assert.equal(result.length, 3);
    assert.ok(result[0]!.ts <= result[1]!.ts && result[1]!.ts <= result[2]!.ts);
  });
});
