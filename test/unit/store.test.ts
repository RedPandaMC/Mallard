import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventStore, rollupEvents } from '../../src/store/EventStore';
import { DAY_MS, startOf } from '../../src/util/time';
import { makeEvent } from './helpers';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'weevil-store-'));
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
    assert.strictEqual(await store.getMeta('fileOffsets'), undefined);
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
});
