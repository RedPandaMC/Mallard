import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventStore, rollupEvents } from '../../src/extension/store/EventStore';
import { DAY_MS, startOf } from '../../src/extension/util/time';
import { makeEvent } from './helpers';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mallard-store-'));
}

describe('EventStore', () => {
  it('appends and persists events across reloads', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    const added = await store.writer.insert([makeEvent({ id: 'a', ts: 1000 }), makeEvent({ id: 'b', ts: 2000 })]);
    assert.strictEqual(added, 2);
    assert.strictEqual(await store.count(), 2);
    store.dispose(); // release the file lock before reopening

    const reloaded = await EventStore.open(dir);
    assert.strictEqual(await reloaded.count(), 2);
    assert.deepStrictEqual(
      (await reloaded.reader.find()).map((e) => e.id),
      ['a', 'b'],
    );
    reloaded.dispose();
  });

  it('dedupes by id within and across appends', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([makeEvent({ id: 'dup', ts: 1000 })]);
    const added = await store.writer.insert([
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
    await store.writer.insert([
      makeEvent({ id: 'late', ts: 5000 }),
      makeEvent({ id: 'early', ts: 1000 }),
      makeEvent({ id: 'mid', ts: 3000 }),
    ]);
    assert.deepStrictEqual(
      (await store.reader.find()).map((e) => e.id),
      ['early', 'mid', 'late'],
    );
    store.dispose();
  });

  it('queries with a filter', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000, modelId: 'gpt-4o' }),
      makeEvent({ id: 'b', ts: 2000, modelId: 'claude-sonnet-4' }),
    ]);
    const onlyGpt = await store.reader.find({ models: ['gpt-4o'] });
    assert.strictEqual(onlyGpt.length, 1);
    assert.strictEqual(onlyGpt[0]!.id, 'a');
    store.dispose();
  });

  it('persists and reads back the per-category cost breakdown', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000, cost: 0.1, costByCategory: { input: 0.06, output: 0.04 } }),
    ]);
    store.dispose();
    const reloaded = await EventStore.open(dir);
    assert.deepStrictEqual((await reloaded.reader.find())[0]!.costByCategory, { input: 0.06, output: 0.04 });
    reloaded.dispose();
  });

  it('filters by repo, matching missing repo via the unattributed sentinel', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000, repo: 'octo/a' }),
      makeEvent({ id: 'b', ts: 2000, repo: 'octo/b' }),
      makeEvent({ id: 'c', ts: 3000 }), // no repo -> stored as NULL
    ]);
    assert.deepStrictEqual(
      (await store.reader.find({ repos: ['octo/a'] })).map((e) => e.id),
      ['a'],
    );
    assert.deepStrictEqual(
      (await store.reader.find({ repos: ['unattributed'] })).map((e) => e.id),
      ['c'],
    );
    assert.deepStrictEqual(
      (await store.reader.find({ repos: ['octo/b', 'unattributed'] })).map((e) => e.id),
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
    await store.writer.insert([makeEvent({ id: 'a', ts: 1000 })]);
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
    await store.writer.insert([
      makeEvent({ id: 'old1', ts: oldTs + 1000, modelId: 'gpt-4o', repo: 'alpha', credits: 2, cost: 0.08 }),
      makeEvent({ id: 'old2', ts: oldTs + 2000, modelId: 'gpt-4o', repo: 'alpha', credits: 3, cost: 0.12 }),
      makeEvent({ id: 'recent', ts: now - DAY_MS, credits: 1, cost: 0.04 }),
    ]);

    await store.compact(now + DAY_MS);

    // The two old events collapse into one rolled row; the recent one survives.
    assert.strictEqual(await store.count(), 2);
    const rolled = (await store.reader.find()).find((e) => e.id.startsWith('roll:'));
    assert.ok(rolled, 'expected a rolled-up row');
    assert.strictEqual(rolled!.credits, 5);
    assert.ok(Math.abs(rolled!.cost - 0.2) < 1e-9);
    assert.strictEqual(rolled!.estimated, true);
    store.dispose();
  });

  it('exports a JSON dump of all events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([makeEvent({ id: 'a', ts: 1000 })]);
    const dump = JSON.parse(JSON.stringify(await store.reader.dump()));
    assert.strictEqual(dump.length, 1);
    assert.strictEqual(dump[0].id, 'a');
    store.dispose();
  });
});

describe('EventStore — extended methods', () => {
  it('compact() is a no-op when all events are recent', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.compact(); // must not throw
    store.dispose();
  });

  it('find() with limit truncates results', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000 }),
      makeEvent({ id: 'b', ts: 2000 }),
      makeEvent({ id: 'c', ts: 3000 }),
      makeEvent({ id: 'd', ts: 4000 }),
      makeEvent({ id: 'e', ts: 5000 }),
    ]);
    const result = await store.reader.find({ limit: 2 });
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0]!.id, 'a');
    assert.strictEqual(result[1]!.id, 'b');
    store.dispose();
  });

  it('find() with offset skips rows', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000 }),
      makeEvent({ id: 'b', ts: 2000 }),
      makeEvent({ id: 'c', ts: 3000 }),
      makeEvent({ id: 'd', ts: 4000 }),
      makeEvent({ id: 'e', ts: 5000 }),
    ]);
    const result = await store.reader.find({ offset: 3 });
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0]!.id, 'd');
    store.dispose();
  });

  it('count() with a filter returns filtered count', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
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
    const result = await store.reader.findById('does-not-exist');
    assert.strictEqual(result, null);
    store.dispose();
  });

  it('exists() returns true for a known id', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([makeEvent({ id: 'known', ts: 1000 })]);
    assert.strictEqual(await store.reader.exists('known'), true);
    store.dispose();
  });

  it('exists() returns false for an unknown id', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    assert.strictEqual(await store.reader.exists('ghost'), false);
    store.dispose();
  });

  it('aggregate() returns statistics for valid fields', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000, credits: 4, cost: 0.16 }),
      makeEvent({ id: 'b', ts: 2000, credits: 6, cost: 0.24 }),
    ]);
    const result = await store.reader.aggregate({}, ['credits', 'cost']);
    assert.strictEqual(result.count, 2);
    assert.ok(Math.abs(result.sum['credits']! - 10) < 1e-9);
    assert.ok(Math.abs(result.mean['credits']! - 5) < 1e-9);
    store.dispose();
  });

  it('aggregate() returns emptyAggregate for unsafe field names', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    const result = await store.reader.aggregate({}, ['credits; DROP TABLE events--']);
    assert.strictEqual(result.count, 0);
    assert.deepStrictEqual(result.sum, {});
    store.dispose();
  });

  it('bucket() by hour groups events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([makeEvent({ id: 'a', ts: new Date('2026-06-01T10:00:00Z').getTime() })]);
    const buckets = await store.reader.bucket({}, 'hour');
    assert.ok(buckets.length > 0);
    assert.ok(typeof buckets[0]!.key === 'string');
    assert.ok(typeof buckets[0]!.values['credits'] === 'number');
    store.dispose();
  });

  it('bucket() by weekday groups events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([makeEvent({ id: 'a', ts: new Date('2026-06-01T10:00:00Z').getTime() })]);
    const buckets = await store.reader.bucket({}, 'weekday');
    assert.ok(buckets.length > 0);
    store.dispose();
  });

  it('bucket() by week groups events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([makeEvent({ id: 'a', ts: new Date('2026-06-01T10:00:00Z').getTime() })]);
    const buckets = await store.reader.bucket({}, 'week');
    assert.ok(buckets.length > 0);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(String(buckets[0]!.key)));
    store.dispose();
  });

  it('bucket() by month groups events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([makeEvent({ id: 'a', ts: new Date('2026-06-01T10:00:00Z').getTime() })]);
    const buckets = await store.reader.bucket({}, 'month');
    assert.ok(buckets.length > 0);
    assert.ok(/^\d{4}-\d{2}$/.test(String(buckets[0]!.key)));
    store.dispose();
  });

  it('bucket() by day groups events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([makeEvent({ id: 'a', ts: new Date('2026-06-01T10:00:00Z').getTime() })]);
    const buckets = await store.reader.bucket({}, 'day');
    assert.ok(buckets.length > 0);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(String(buckets[0]!.key)));
    store.dispose();
  });

  it('pivot() returns cross-tab by surface', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000, surface: 'chat', credits: 3 }),
      makeEvent({ id: 'b', ts: 2000, surface: 'inline', credits: 2 }),
    ]);
    const result = await store.reader.pivot({}, 'surface', 'credits');
    assert.ok(result.columnKeys.length > 0);
    assert.ok(result.rows.length > 0);
    store.dispose();
  });

  it('pivot() returns empty CrossTab when no data', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    const result = await store.reader.pivot({}, 'surface', 'credits');
    assert.deepStrictEqual(result, { rows: [], columnKeys: [] });
    store.dispose();
  });

  it('rank() returns top models by credits', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000, modelId: 'gpt-4o', credits: 10 }),
      makeEvent({ id: 'b', ts: 2000, modelId: 'claude-sonnet-4', credits: 5 }),
    ]);
    const result = await store.reader.rank({}, 'credits', 5);
    assert.strictEqual(result[0]!.key, 'gpt-4o');
    assert.ok(result[0]!.values['credits']! > result[1]!.values['credits']!);
    store.dispose();
  });

  it('remove() with a filter deletes matching rows and returns count', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000, modelId: 'gpt-4o' }),
      makeEvent({ id: 'b', ts: 2000, modelId: 'claude-sonnet-4' }),
    ]);
    const removed = await store.writer.remove({ models: ['gpt-4o'] });
    assert.strictEqual(removed, 1);
    assert.strictEqual(await store.count(), 1);
    store.dispose();
  });

  it('remove() with empty filter returns 0 without deleting', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([makeEvent({ id: 'a', ts: 1000 })]);
    const removed = await store.writer.remove({});
    assert.strictEqual(removed, 0);
    assert.strictEqual(await store.count(), 1);
    store.dispose();
  });

  it('compact() is a no-op when all events are recent', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
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
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000, branch: 'main' }),
      makeEvent({ id: 'b', ts: 2000, branch: 'feature' }),
    ]);
    const result = await store.reader.find({ branches: ['main'] });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.id, 'a');
    store.dispose();
  });

  it('find() with sources filter returns only matching events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000, source: 'local' }),
      makeEvent({ id: 'b', ts: 2000, source: 'claude-code' }),
    ]);
    const result = await store.reader.find({ sources: ['claude-code'] });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.id, 'b');
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

describe('EventStore — remove() filter dimensions', () => {
  it('remove() with surfaces filter deletes only matching events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000, surface: 'chat' }),
      makeEvent({ id: 'b', ts: 2000, surface: 'inline' }),
    ]);
    const removed = await store.writer.remove({ surfaces: ['chat'] });
    assert.strictEqual(removed, 1);
    assert.strictEqual(await store.count(), 1);
    assert.strictEqual((await store.reader.find())[0]!.id, 'b');
    store.dispose();
  });

  it('remove() with sources filter deletes only matching events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000, source: 'local' }),
      makeEvent({ id: 'b', ts: 2000, source: 'claude-code' }),
    ]);
    const removed = await store.writer.remove({ sources: ['claude-code'] });
    assert.strictEqual(removed, 1);
    assert.strictEqual(await store.count(), 1);
    assert.strictEqual((await store.reader.find())[0]!.id, 'a');
    store.dispose();
  });

  it('remove() with branches filter deletes only matching events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000, branch: 'main' }),
      makeEvent({ id: 'b', ts: 2000, branch: 'feature' }),
    ]);
    const removed = await store.writer.remove({ branches: ['main'] });
    assert.strictEqual(removed, 1);
    assert.strictEqual(await store.count(), 1);
    assert.strictEqual((await store.reader.find())[0]!.id, 'b');
    store.dispose();
  });

  it('remove() with named repos filter deletes only the named repo', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000, repo: 'org/alpha' }),
      makeEvent({ id: 'b', ts: 2000, repo: 'org/beta' }),
      makeEvent({ id: 'c', ts: 3000 }), // NULL repo
    ]);
    const removed = await store.writer.remove({ repos: ['org/alpha'] });
    assert.strictEqual(removed, 1);
    assert.strictEqual(await store.count(), 2);
    store.dispose();
  });

  it('remove() with combined named + unattributed repos deletes both', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000, repo: 'org/alpha' }),
      makeEvent({ id: 'b', ts: 2000, repo: 'org/beta' }),
      makeEvent({ id: 'c', ts: 3000 }), // NULL repo
    ]);
    const removed = await store.writer.remove({ repos: ['org/alpha', 'unattributed'] });
    assert.strictEqual(removed, 2);
    assert.strictEqual(await store.count(), 1);
    assert.strictEqual((await store.reader.find())[0]!.id, 'b');
    store.dispose();
  });

  it('remove() with range filter deletes only events in the range', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000 }),
      makeEvent({ id: 'b', ts: 5000 }),
      makeEvent({ id: 'c', ts: 9000 }),
    ]);
    const removed = await store.writer.remove({ range: { start: 2000, end: 8000 } });
    assert.strictEqual(removed, 1);
    assert.strictEqual(await store.count(), 2);
    const remaining = (await store.reader.find()).map((e) => e.id);
    assert.ok(remaining.includes('a'));
    assert.ok(remaining.includes('c'));
    store.dispose();
  });
});

describe('EventStore — setPrices', () => {
  it('setPrices() stores multipliers without throwing', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.setPrices([
      { modelId: 'gpt-4o', multiplier: 2 },
      { modelId: 'claude-sonnet-4', multiplier: 3 },
    ]);
    store.dispose();
  });

  it('setPrices() with empty array clears all prices', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.setPrices([{ modelId: 'gpt-4o', multiplier: 2 }]);
    await store.writer.setPrices([]);
    store.dispose();
  });
});

describe('EventStore — insert edge cases', () => {
  it('insert() with empty array returns 0 without writing to db', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    const inserted = await store.writer.insert([]);
    assert.strictEqual(inserted, 0);
    assert.strictEqual(await store.count(), 0);
    store.dispose();
  });

  it('insert() with promptTokens and completionTokens stores token counts', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000, promptTokens: 100, completionTokens: 50 }),
    ]);
    const events = await store.reader.find();
    assert.strictEqual(events[0]!.promptTokens, 100);
    assert.strictEqual(events[0]!.completionTokens, 50);
    store.dispose();
  });
});

describe('EventStore — queryFacts', () => {
  it('queryFacts() returns empty array when no facts exist', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    const rows = await store.reader.queryFacts();
    assert.deepStrictEqual(rows, []);
    store.dispose();
  });

  it('queryFacts() with range filter returns facts in range', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    // Use today's timestamp so insert() refreshes facts for today
    const ts = startOf(Date.now(), 'day') + 3600000;
    await store.writer.insert([makeEvent({ id: 'a', ts, credits: 5 })]);
    const rows = await store.reader.queryFacts({
      range: { start: ts - DAY_MS, end: ts + DAY_MS },
    });
    assert.strictEqual(rows.length, 1);
    assert.ok(rows[0]!.credits > 0);
    store.dispose();
  });

  it('queryFacts() with models filter counts only matching model', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    const base = startOf(Date.now(), 'day') + 3600000;
    await store.writer.insert([
      makeEvent({ id: 'a', ts: base, modelId: 'gpt-4o', credits: 3 }),
      makeEvent({ id: 'b', ts: base + 60000, modelId: 'claude-sonnet-4', credits: 7 }),
    ]);
    const rows = await store.reader.queryFacts({ models: ['gpt-4o'] });
    const total = rows.reduce((s, r) => s + r.credits, 0);
    assert.ok(total > 0 && total < 10);
    store.dispose();
  });

  it('queryFacts() with surfaces filter narrows results', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    const base = startOf(Date.now(), 'day') + 7200000;
    await store.writer.insert([
      makeEvent({ id: 'a', ts: base, surface: 'chat', credits: 2 }),
      makeEvent({ id: 'b', ts: base + 60000, surface: 'inline', credits: 8 }),
    ]);
    const rows = await store.reader.queryFacts({ surfaces: ['chat'] });
    const total = rows.reduce((s, r) => s + r.credits, 0);
    assert.ok(total > 0 && total < 10);
    store.dispose();
  });

  it('queryFacts() with sources filter narrows results', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    const base = startOf(Date.now(), 'day') + 10800000;
    await store.writer.insert([
      makeEvent({ id: 'a', ts: base, source: 'local', credits: 4 }),
      makeEvent({ id: 'b', ts: base + 60000, source: 'claude-code', credits: 6 }),
    ]);
    const rows = await store.reader.queryFacts({ sources: ['local'] });
    const total = rows.reduce((s, r) => s + r.credits, 0);
    assert.ok(total > 0 && total < 10);
    store.dispose();
  });

  it('queryFacts() with named repos filter', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    const base = startOf(Date.now(), 'day') + 14400000;
    await store.writer.insert([
      makeEvent({ id: 'a', ts: base, repo: 'org/x', credits: 3 }),
      makeEvent({ id: 'b', ts: base + 60000, credits: 7 }),
    ]);
    const withRepo = await store.reader.queryFacts({ repos: ['org/x'] });
    assert.ok(withRepo.reduce((s, r) => s + r.credits, 0) > 0);
    store.dispose();
  });

  it('queryFacts() with repos: unattributed filter', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    const base = startOf(Date.now(), 'day') + 18000000;
    await store.writer.insert([
      makeEvent({ id: 'a', ts: base, repo: 'org/x', credits: 3 }),
      makeEvent({ id: 'b', ts: base + 60000, credits: 7 }),
    ]);
    const unattr = await store.reader.queryFacts({ repos: ['unattributed'] });
    assert.ok(unattr.reduce((s, r) => s + r.credits, 0) > 0);
    store.dispose();
  });
});

describe('EventStore — deprecated query()', () => {
  it('query() delegates to find() and returns the same results', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([makeEvent({ id: 'a', ts: 1000, modelId: 'gpt-4o' })]);
    const fromQuery = await store.reader.query({ models: ['gpt-4o'] });
    const fromFind = await store.reader.find({ models: ['gpt-4o'] });
    assert.deepStrictEqual(
      fromQuery.map((e) => e.id),
      fromFind.map((e) => e.id),
    );
    store.dispose();
  });
});

describe('EventStore — filter edge cases', () => {
  it('query with range filter returns only events in range', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000 }),
      makeEvent({ id: 'b', ts: 5000 }),
      makeEvent({ id: 'c', ts: 9000 }),
    ]);
    const result = await store.reader.find({ range: { start: 2000, end: 8000 } });
    assert.deepStrictEqual(result.map((e) => e.id), ['b']);
    store.dispose();
  });

  it('query with surfaces filter returns only matching events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000, surface: 'chat' }),
      makeEvent({ id: 'b', ts: 2000, surface: 'inline' }),
    ]);
    const result = await store.reader.find({ surfaces: ['chat'] });
    assert.deepStrictEqual(result.map((e) => e.id), ['a']);
    store.dispose();
  });

  it('remove() with unattributed repo sentinel uses parameterless SQL', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    await store.writer.insert([
      makeEvent({ id: 'a', ts: 1000 }), // no repo → NULL
      makeEvent({ id: 'b', ts: 2000, repo: 'org/x' }),
    ]);
    const removed = await store.writer.remove({ repos: ['unattributed'] });
    assert.strictEqual(removed, 1);
    assert.strictEqual(await store.count(), 1);
    store.dispose();
  });
});

describe('EventStore — readSnapshotCache', () => {
  it('returns zero totals when store is empty', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    const cache = await store.reader.readSnapshotCache();
    assert.strictEqual(cache.totals.all.credits, 0);
    assert.strictEqual(cache.totals.mtd.credits, 0);
    assert.strictEqual(cache.totals.today.credits, 0);
    assert.deepStrictEqual(cache.daily, []);
    assert.deepStrictEqual(cache.models, []);
    assert.deepStrictEqual(cache.repos, []);
    assert.deepStrictEqual(cache.dims.models, []);
    store.dispose();
  });

  it('returns aggregated totals after inserting events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    const now = Date.now();
    await store.writer.insert([
      makeEvent({ id: 'a', ts: now, credits: 5, cost: 0.20, modelId: 'gpt-4o', repo: 'org/x', branch: 'main' }),
      makeEvent({ id: 'b', ts: now, credits: 3, cost: 0.12, modelId: 'claude-sonnet-4-6' }),
    ]);
    const cache = await store.reader.readSnapshotCache();
    assert.ok(cache.totals.all.credits >= 8, 'all.credits should be >= 8');
    assert.ok(cache.totals.today.credits >= 8, 'today.credits should be >= 8');
    assert.ok(cache.models.length >= 2, 'should have at least 2 models');
    assert.ok(cache.dims.models.includes('gpt-4o'), 'dim_models should include gpt-4o');
    assert.ok(cache.dims.models.includes('claude-sonnet-4-6'));
    assert.ok(cache.dims.sources.includes('local'));
    assert.ok(cache.sankey.length > 0, 'sankey should be populated');
    assert.ok(cache.repos.length > 0, 'repos should be populated');
    store.dispose();
  });

  it('populates hourly and category breakdowns', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    const now = Date.now();
    await store.writer.insert([
      makeEvent({ id: 'a', ts: now, credits: 2, costByCategory: { input: 0.05, output: 0.03 } }),
    ]);
    const cache = await store.reader.readSnapshotCache();
    assert.ok(cache.categories.length > 0, 'categories should be populated');
    store.dispose();
  });
});

describe('EventStore — creditsByBranch', () => {
  it('returns summed credits for a matching branch', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    const now = Date.now();
    await store.writer.insert([
      makeEvent({ id: 'a', ts: now, credits: 4, branch: 'main' }),
      makeEvent({ id: 'b', ts: now, credits: 2, branch: 'dev' }),
      makeEvent({ id: 'c', ts: now, credits: 1 }), // no branch
    ]);
    const credits = await store.reader.creditsByBranch('main');
    assert.strictEqual(credits, 4);
    store.dispose();
  });

  it('returns 0 for a branch with no events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    const credits = await store.reader.creditsByBranch('nonexistent');
    assert.strictEqual(credits, 0);
    store.dispose();
  });
});
