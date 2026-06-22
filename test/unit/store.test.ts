import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventStore } from '../../src/store/EventStore';
import { rollupEvents } from '../../src/domain/rollup';
import { DAY_MS, startOf } from '../../src/util/time';
import { makeEvent } from './helpers';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mallard-store-'));
}

describe('EventStore', () => {
  it('appends and persists events across reloads', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    const added = await store.append([makeEvent({ id: 'a', ts: 1000 }), makeEvent({ id: 'b', ts: 2000 })]);
    assert.strictEqual(added, 2);
    assert.strictEqual(await store.count(), 2);
    store.dispose(); // release the file lock before reopening

    const reloaded = await EventStore.open(dir);
    assert.strictEqual(await reloaded.count(), 2);
    assert.deepStrictEqual(
      (await reloaded.all()).map((e) => e.id),
      ['a', 'b'],
    );
    reloaded.dispose();
  });

  it('dedupes by id within and across appends', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([makeEvent({ id: 'dup', ts: 1000 })]);
    const added = await store.append([
      makeEvent({ id: 'dup', ts: 9999 }),
      makeEvent({ id: 'new', ts: 3000 }),
    ]);
    assert.strictEqual(added, 1);
    assert.strictEqual(await store.count(), 2);
    store.dispose();
  });

  it('keeps events sorted by timestamp', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'late', ts: 5000 }),
      makeEvent({ id: 'early', ts: 1000 }),
      makeEvent({ id: 'mid', ts: 3000 }),
    ]);
    assert.deepStrictEqual(
      (await store.all()).map((e) => e.id),
      ['early', 'mid', 'late'],
    );
    store.dispose();
  });

  it('queries with a filter', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, modelId: 'gpt-4o' }),
      makeEvent({ id: 'b', ts: 2000, modelId: 'claude-sonnet-4' }),
    ]);
    const onlyGpt = await store.query({ models: ['gpt-4o'] });
    assert.strictEqual(onlyGpt.length, 1);
    assert.strictEqual(onlyGpt[0]!.id, 'a');
    store.dispose();
  });

  it('persists and reads back the per-category cost breakdown', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, cost: 0.1, costByCategory: { input: 0.06, output: 0.04 } }),
    ]);
    store.dispose();
    const reloaded = await EventStore.open(dir);
    assert.deepStrictEqual((await reloaded.all())[0]!.costByCategory, { input: 0.06, output: 0.04 });
    reloaded.dispose();
  });

  it('filters by repo, matching missing repo via the unattributed sentinel', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, repo: 'octo/a' }),
      makeEvent({ id: 'b', ts: 2000, repo: 'octo/b' }),
      makeEvent({ id: 'c', ts: 3000 }), // no repo -> stored as NULL
    ]);
    assert.deepStrictEqual(
      (await store.query({ repos: ['octo/a'] })).map((e) => e.id),
      ['a'],
    );
    assert.deepStrictEqual(
      (await store.query({ repos: ['unattributed'] })).map((e) => e.id),
      ['c'],
    );
    assert.deepStrictEqual(
      (await store.query({ repos: ['octo/b', 'unattributed'] })).map((e) => e.id),
      ['b', 'c'],
    );
    store.dispose();
  });

  it('persists log read offsets in the meta table', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.setMeta('fileOffsets', JSON.stringify([['/path/a.log', 4096]]));
    store.dispose();
    const reopened = await EventStore.open(dir);
    assert.strictEqual(await reopened.getMeta('fileOffsets'), '[["/path/a.log",4096]]');
    reopened.dispose();
  });

  it('clears all events and read offsets', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([makeEvent({ id: 'a', ts: 1000 })]);
    await store.setMeta('fileOffsets', '[["x",1]]');
    await store.clear();
    assert.strictEqual(await store.count(), 0);
    assert.strictEqual(await store.getMeta('fileOffsets'), null);
    store.dispose();
  });

  it('rolls up events older than the raw window into daily rows', async () => {
    const dir = await tmpDir();
    const now = startOf(Date.now(), 'day');
    const oldTs = now - 200 * DAY_MS; // well beyond the 90-day window
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'old1', ts: oldTs + 1000, modelId: 'gpt-4o', repo: 'alpha', credits: 2, cost: 0.08 }),
      makeEvent({ id: 'old2', ts: oldTs + 2000, modelId: 'gpt-4o', repo: 'alpha', credits: 3, cost: 0.12 }),
      makeEvent({ id: 'recent', ts: now - DAY_MS, credits: 1, cost: 0.04 }),
    ]);

    await store.rollup(now + DAY_MS);

    // The two old events collapse into one rolled row; the recent one survives.
    assert.strictEqual(await store.count(), 2);
    const rolled = (await store.all()).find((e) => e.id.startsWith('roll:'));
    assert.ok(rolled, 'expected a rolled-up row');
    assert.strictEqual(rolled!.credits, 5);
    assert.ok(Math.abs(rolled!.cost - 0.2) < 1e-9);
    assert.strictEqual(rolled!.estimated, true);
    store.dispose();
  });

  it('exports a JSON dump of all events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([makeEvent({ id: 'a', ts: 1000 })]);
    const dump = JSON.parse(await store.export());
    assert.strictEqual(dump.length, 1);
    assert.strictEqual(dump[0].id, 'a');
    store.dispose();
  });
});

describe('EventStore — extended methods', () => {
  it('load() is a no-op', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.load(); // must not throw
    store.dispose();
  });

  it('find() with limit truncates results', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000 }),
      makeEvent({ id: 'b', ts: 2000 }),
      makeEvent({ id: 'c', ts: 3000 }),
      makeEvent({ id: 'd', ts: 4000 }),
      makeEvent({ id: 'e', ts: 5000 }),
    ]);
    const result = await store.find({ limit: 2 });
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0]!.id, 'a');
    assert.strictEqual(result[1]!.id, 'b');
    store.dispose();
  });

  it('find() with offset skips rows', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000 }),
      makeEvent({ id: 'b', ts: 2000 }),
      makeEvent({ id: 'c', ts: 3000 }),
      makeEvent({ id: 'd', ts: 4000 }),
      makeEvent({ id: 'e', ts: 5000 }),
    ]);
    const result = await store.find({ offset: 3 });
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0]!.id, 'd');
    store.dispose();
  });

  it('count() with a filter returns filtered count', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, modelId: 'gpt-4o' }),
      makeEvent({ id: 'b', ts: 2000, modelId: 'gpt-4o' }),
      makeEvent({ id: 'c', ts: 3000, modelId: 'claude-sonnet-4' }),
    ]);
    const n = await store.count({ models: ['gpt-4o'] });
    assert.strictEqual(n, 2);
    store.dispose();
  });

  it('findById() returns null for unknown id', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    const result = await store.findById('does-not-exist');
    assert.strictEqual(result, null);
    store.dispose();
  });

  it('exists() returns true for a known id', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([makeEvent({ id: 'known', ts: 1000 })]);
    assert.strictEqual(await store.exists('known'), true);
    store.dispose();
  });

  it('exists() returns false for an unknown id', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    assert.strictEqual(await store.exists('ghost'), false);
    store.dispose();
  });

  it('aggregate() returns statistics for valid fields', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, credits: 4, cost: 0.16 }),
      makeEvent({ id: 'b', ts: 2000, credits: 6, cost: 0.24 }),
    ]);
    const result = await store.aggregate({}, ['credits', 'cost']);
    assert.strictEqual(result.count, 2);
    assert.ok(Math.abs(result.sum['credits']! - 10) < 1e-9);
    assert.ok(Math.abs(result.mean['credits']! - 5) < 1e-9);
    store.dispose();
  });

  it('aggregate() returns emptyAggregate for unsafe field names', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    const result = await store.aggregate({}, ['credits; DROP TABLE events--']);
    assert.strictEqual(result.count, 0);
    assert.deepStrictEqual(result.sum, {});
    store.dispose();
  });

  it('bucket() by hour groups events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([makeEvent({ id: 'a', ts: new Date('2026-06-01T10:00:00Z').getTime() })]);
    const buckets = await store.bucket({}, 'hour');
    assert.ok(buckets.length > 0);
    assert.ok(typeof buckets[0]!.key === 'string');
    assert.ok(typeof buckets[0]!.values['credits'] === 'number');
    store.dispose();
  });

  it('bucket() by weekday groups events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([makeEvent({ id: 'a', ts: new Date('2026-06-01T10:00:00Z').getTime() })]);
    const buckets = await store.bucket({}, 'weekday');
    assert.ok(buckets.length > 0);
    store.dispose();
  });

  it('bucket() by week groups events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([makeEvent({ id: 'a', ts: new Date('2026-06-01T10:00:00Z').getTime() })]);
    const buckets = await store.bucket({}, 'week');
    assert.ok(buckets.length > 0);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(String(buckets[0]!.key)));
    store.dispose();
  });

  it('bucket() by month groups events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([makeEvent({ id: 'a', ts: new Date('2026-06-01T10:00:00Z').getTime() })]);
    const buckets = await store.bucket({}, 'month');
    assert.ok(buckets.length > 0);
    assert.ok(/^\d{4}-\d{2}$/.test(String(buckets[0]!.key)));
    store.dispose();
  });

  it('bucket() by day groups events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([makeEvent({ id: 'a', ts: new Date('2026-06-01T10:00:00Z').getTime() })]);
    const buckets = await store.bucket({}, 'day');
    assert.ok(buckets.length > 0);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(String(buckets[0]!.key)));
    store.dispose();
  });

  it('pivot() returns cross-tab by surface', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, surface: 'chat', credits: 3 }),
      makeEvent({ id: 'b', ts: 2000, surface: 'inline', credits: 2 }),
    ]);
    const result = await store.pivot({}, 'surface', 'credits');
    assert.ok(result.columnKeys.length > 0);
    assert.ok(result.rows.length > 0);
    store.dispose();
  });

  it('pivot() returns empty CrossTab when no data', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    const result = await store.pivot({}, 'surface', 'credits');
    assert.deepStrictEqual(result, { rows: [], columnKeys: [] });
    store.dispose();
  });

  it('rank() returns top models by credits with event_count', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, modelId: 'gpt-4o', credits: 10 }),
      makeEvent({ id: 'b', ts: 2000, modelId: 'gpt-4o', credits: 5 }),
      makeEvent({ id: 'c', ts: 3000, modelId: 'claude-sonnet-4', credits: 3 }),
    ]);
    const result = await store.rank({}, 'credits', 5);
    assert.strictEqual(result[0]!.key, 'gpt-4o');
    assert.ok(result[0]!.values['credits']! > result[1]!.values['credits']!);
    assert.strictEqual(result[0]!.values['event_count'], 2);
    assert.strictEqual(result[1]!.values['event_count'], 1);
    store.dispose();
  });

  it('remove() with a filter deletes matching rows and returns count', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, modelId: 'gpt-4o' }),
      makeEvent({ id: 'b', ts: 2000, modelId: 'claude-sonnet-4' }),
    ]);
    const removed = await store.remove({ models: ['gpt-4o'] });
    assert.strictEqual(removed, 1);
    assert.strictEqual(await store.count(), 1);
    store.dispose();
  });

  it('remove() with empty filter returns 0 without deleting', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([makeEvent({ id: 'a', ts: 1000 })]);
    const removed = await store.remove({});
    assert.strictEqual(removed, 0);
    assert.strictEqual(await store.count(), 1);
    store.dispose();
  });

  it('remove() with surfaces filter deletes only matching events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, surface: 'chat' }),
      makeEvent({ id: 'b', ts: 2000, surface: 'inline' }),
    ]);
    const removed = await store.remove({ surfaces: ['chat'] });
    assert.strictEqual(removed, 1);
    assert.deepStrictEqual((await store.all()).map((e) => e.id), ['b']);
    store.dispose();
  });

  it('remove() with branches filter deletes only matching events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, branch: 'main' }),
      makeEvent({ id: 'b', ts: 2000, branch: 'feat' }),
    ]);
    const removed = await store.remove({ branches: ['main'] });
    assert.strictEqual(removed, 1);
    assert.deepStrictEqual((await store.all()).map((e) => e.id), ['b']);
    store.dispose();
  });

  it('remove() with sources filter deletes only matching events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, source: 'local' }),
      makeEvent({ id: 'b', ts: 2000, source: 'claude-code' }),
    ]);
    const removed = await store.remove({ sources: ['local'] });
    assert.strictEqual(removed, 1);
    assert.deepStrictEqual((await store.all()).map((e) => e.id), ['b']);
    store.dispose();
  });

  it('compact() is a no-op when all events are recent', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: Date.now() - DAY_MS }),
      makeEvent({ id: 'b', ts: Date.now() }),
    ]);
    await store.compact(Date.now());
    assert.strictEqual(await store.count(), 2);
    store.dispose();
  });

  it('find() with branches filter returns only matching events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, branch: 'main' }),
      makeEvent({ id: 'b', ts: 2000, branch: 'feature' }),
    ]);
    const result = await store.find({ branches: ['main'] });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.id, 'a');
    store.dispose();
  });

  it('find() with sources filter returns only matching events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, source: 'local' }),
      makeEvent({ id: 'b', ts: 2000, source: 'claude-code' }),
    ]);
    const result = await store.find({ sources: ['claude-code'] });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.id, 'b');
    store.dispose();
  });
});

describe('EventStore — analytics with filters (buildWhereSql coverage)', () => {
  it('aggregate() with range filter returns only matching events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, credits: 2 }),
      makeEvent({ id: 'b', ts: 5000, credits: 8 }),
    ]);
    const result = await store.aggregate({ range: { start: 0, end: 3000 } }, ['credits']);
    assert.strictEqual(result.count, 1);
    assert.ok(Math.abs(result.sum['credits']! - 2) < 1e-9);
    store.dispose();
  });

  it('aggregate() with models filter returns only matching events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, modelId: 'gpt-4o', credits: 3 }),
      makeEvent({ id: 'b', ts: 2000, modelId: 'claude-3', credits: 5 }),
    ]);
    const result = await store.aggregate({ models: ['gpt-4o'] }, ['credits']);
    assert.strictEqual(result.count, 1);
    assert.ok(Math.abs(result.sum['credits']! - 3) < 1e-9);
    store.dispose();
  });

  it('aggregate() with surfaces filter returns only matching events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, surface: 'chat', credits: 4 }),
      makeEvent({ id: 'b', ts: 2000, surface: 'inline', credits: 6 }),
    ]);
    const result = await store.aggregate({ surfaces: ['chat'] }, ['credits']);
    assert.strictEqual(result.count, 1);
    assert.ok(Math.abs(result.sum['credits']! - 4) < 1e-9);
    store.dispose();
  });

  it('aggregate() with repos filter (named repo) returns only matching events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, repo: 'org/repo-a', credits: 2 }),
      makeEvent({ id: 'b', ts: 2000, repo: 'org/repo-b', credits: 7 }),
    ]);
    const result = await store.aggregate({ repos: ['org/repo-a'] }, ['credits']);
    assert.strictEqual(result.count, 1);
    assert.ok(Math.abs(result.sum['credits']! - 2) < 1e-9);
    store.dispose();
  });

  it('aggregate() with repos filter (unattributed + named) returns both', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, credits: 2 }),            // no repo → unattributed
      makeEvent({ id: 'b', ts: 2000, repo: 'org/x', credits: 3 }),
      makeEvent({ id: 'c', ts: 3000, repo: 'org/y', credits: 7 }),
    ]);
    const result = await store.aggregate({ repos: ['unattributed', 'org/x'] }, ['credits']);
    assert.strictEqual(result.count, 2);
    assert.ok(Math.abs(result.sum['credits']! - 5) < 1e-9);
    store.dispose();
  });

  it('aggregate() with branches filter returns only matching events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, branch: 'main', credits: 3 }),
      makeEvent({ id: 'b', ts: 2000, branch: 'feat', credits: 9 }),
    ]);
    const result = await store.aggregate({ branches: ['main'] }, ['credits']);
    assert.strictEqual(result.count, 1);
    store.dispose();
  });

  it('aggregate() with sources filter returns only matching events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, source: 'local', credits: 2 }),
      makeEvent({ id: 'b', ts: 2000, source: 'github', credits: 8 }),
    ]);
    const result = await store.aggregate({ sources: ['local'] }, ['credits']);
    assert.strictEqual(result.count, 1);
    store.dispose();
  });

  it('rank() with range filter narrows results', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, modelId: 'gpt-4o', credits: 10 }),
      makeEvent({ id: 'b', ts: 9000, modelId: 'claude', credits: 50 }),
    ]);
    const result = await store.rank({ range: { start: 0, end: 5000 } }, 'credits', 5);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.key, 'gpt-4o');
    store.dispose();
  });

  it('bucket() with range filter narrows results', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: new Date('2026-06-01T10:00:00Z').getTime(), credits: 1 }),
      makeEvent({ id: 'b', ts: new Date('2026-06-15T10:00:00Z').getTime(), credits: 2 }),
    ]);
    const start = new Date('2026-06-14').getTime();
    const end   = new Date('2026-06-16').getTime();
    const buckets = await store.bucket({ range: { start, end } }, 'day');
    assert.strictEqual(buckets.length, 1);
    assert.ok(buckets[0]!.key.toString().startsWith('2026-06-15'));
    store.dispose();
  });

  it('pivot() with models filter narrows results', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, modelId: 'gpt-4o', surface: 'chat', credits: 5 }),
      makeEvent({ id: 'b', ts: 2000, modelId: 'claude', surface: 'inline', credits: 3 }),
    ]);
    const result = await store.pivot({ models: ['gpt-4o'] }, 'surface', 'credits');
    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(result.rows[0]!['modelId'], 'gpt-4o');
    store.dispose();
  });

  it('insert() batch: 100 events in one call, all deduplicated correctly', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    const events = Array.from({ length: 100 }, (_, i) =>
      makeEvent({ id: `batch-${i}`, ts: i * 1000 + 1 }),
    );
    const added = await store.insert(events);
    assert.strictEqual(added, 100);
    assert.strictEqual(await store.count(), 100);
    // Re-insert same IDs — should add 0 new
    const dupes = await store.insert(events);
    assert.strictEqual(dupes, 0);
    store.dispose();
  });
});

describe('rollupEvents', () => {
  it('groups by day/model/repo/surface and sums metrics', () => {
    const day = startOf(1_700_000_000_000, 'day');
    const rolled = rollupEvents([
      makeEvent({ id: '1', ts: day + 1000, modelId: 'gpt-4o', repo: 'r', surface: 'chat', credits: 1, cost: 0.04, promptTokens: 100, completionTokens: 50 }),
      makeEvent({ id: '2', ts: day + 2000, modelId: 'gpt-4o', repo: 'r', surface: 'chat', credits: 2, cost: 0.08, promptTokens: 200, completionTokens: 75 }),
      makeEvent({ id: '3', ts: day + 3000, modelId: 'o3', repo: 'r', surface: 'chat', credits: 5, cost: 0.2 }),
    ]);
    assert.strictEqual(rolled.length, 2);
    const gpt = rolled.find((e) => e.modelId === 'gpt-4o')!;
    assert.strictEqual(gpt.credits, 3);
    assert.ok(Math.abs(gpt.cost - 0.12) < 1e-9);
    assert.strictEqual(gpt.promptTokens, 300);
    assert.strictEqual(gpt.completionTokens, 125);
    assert.strictEqual(gpt.ts, day);
  });

  it('returns nothing for empty input', () => {
    assert.deepStrictEqual(rollupEvents([]), []);
  });

  it('merges costByCategory across events with different category keys', () => {
    const day = startOf(1_700_000_000_000, 'day');
    const rolled = rollupEvents([
      makeEvent({ id: 'a', ts: day + 1000, modelId: 'gpt-4o', repo: 'r', surface: 'chat', credits: 1, cost: 0.1, costByCategory: { input: 0.06 } }),
      makeEvent({ id: 'b', ts: day + 2000, modelId: 'gpt-4o', repo: 'r', surface: 'chat', credits: 1, cost: 0.1, costByCategory: { output: 0.04 } }),
    ]);
    assert.strictEqual(rolled.length, 1);
    const merged = rolled[0]!.costByCategory!;
    assert.ok(Math.abs((merged['input'] ?? 0) - 0.06) < 1e-9);
    assert.ok(Math.abs((merged['output'] ?? 0) - 0.04) < 1e-9);
  });
});

describe('EventStore — filter edge cases', () => {
  it('query with range filter returns only events in range', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000 }),
      makeEvent({ id: 'b', ts: 5000 }),
      makeEvent({ id: 'c', ts: 9000 }),
    ]);
    const result = await store.query({ range: { start: 2000, end: 8000 } });
    assert.deepStrictEqual(result.map((e) => e.id), ['b']);
    store.dispose();
  });

  it('query with surfaces filter returns only matching events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000, surface: 'chat' }),
      makeEvent({ id: 'b', ts: 2000, surface: 'inline' }),
    ]);
    const result = await store.query({ surfaces: ['chat'] });
    assert.deepStrictEqual(result.map((e) => e.id), ['a']);
    store.dispose();
  });

  it('remove() with unattributed repo sentinel uses parameterless SQL', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.append([
      makeEvent({ id: 'a', ts: 1000 }), // no repo → NULL
      makeEvent({ id: 'b', ts: 2000, repo: 'org/x' }),
    ]);
    const removed = await store.remove({ repos: ['unattributed'] });
    assert.strictEqual(removed, 1);
    assert.strictEqual(await store.count(), 1);
    store.dispose();
  });

  it('all() silently drops rows with malformed costByCategory JSON', async () => {
    // Create the store to establish the schema, then close it so we can
    // use DuckDB directly to inject a row with deliberately corrupted JSON —
    // something that cannot happen through the normal store API.
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    store.dispose();

    const { DuckDBInstance } = await import('@duckdb/node-api');
    const rawInstance = await DuckDBInstance.create(path.join(dir, 'events.duckdb'));
    const rawConn = await rawInstance.connect();
    await rawConn.run(
      `INSERT INTO events (id, ts, modelId, surface, source, credits, cost, estimated, costByCategory)
       VALUES ('bad-cat', 9999, 'gpt-4o', 'chat', 'local', 1.0, 0.04, true, 'not-valid-json')`,
    );
    rawConn.closeSync();
    rawInstance.closeSync();

    const reloaded = await EventStore.open(dir);
    const all = await reloaded.all();
    const bad = all.find((e) => e.id === 'bad-cat');
    assert.ok(bad, 'row with bad JSON should still be returned');
    assert.strictEqual(bad!.costByCategory, undefined);
    reloaded.dispose();
  });
});
