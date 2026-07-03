import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventStore } from '../../../src/extension-backend/store/EventStore';
import { DAY_MS, startOf } from '../../../src/extension-backend/util/time';
import { makeEvent } from '../helpers';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mallard-filtered-'));
}

describe('EventReader.readFilteredSnapshot', () => {
  it('returns all-zero totals and empty arrays for an empty store', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    try {
      const data = await store.reader.readFilteredSnapshot({});
      assert.equal(data.totals.all.credits, 0);
      assert.equal(data.totals.all.eventCount, 0);
      assert.equal(data.totals.mtd.credits, 0);
      assert.equal(data.totals.today.credits, 0);
      assert.deepEqual(data.daily, []);
      assert.deepEqual(data.models, []);
      assert.deepEqual(data.repos, []);
      assert.deepEqual(data.sankey, []);
      assert.deepEqual(data.categories, []);
      assert.deepEqual(data.hourly, []);
      assert.deepEqual(data.dims.models, []);
    } finally { store.dispose(); }
  });

  it('aggregates a single event into totals, daily, topModels, and sankey', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    try {
      const now = Date.now();
      await store.writer.insert([makeEvent({ ts: now - 1000, credits: 5, cost: 0.20, modelId: 'gpt-4o', surface: 'chat' })]);
      const data = await store.reader.readFilteredSnapshot({});
      assert.equal(data.totals.all.credits, 5);
      assert.ok(Math.abs(data.totals.all.cost - 0.20) < 1e-9);
      assert.equal(data.totals.all.eventCount, 1);
      assert.equal(data.daily.length, 1);
      assert.equal(data.daily[0]!.credits, 5);
      assert.equal(data.models.length, 1);
      assert.equal(data.models[0]!.modelId, 'gpt-4o');
      assert.equal(data.models[0]!.credits, 5);
      assert.equal(data.sankey.length, 1);
      assert.equal(data.sankey[0]!.model, 'gpt-4o');
      assert.equal(data.sankey[0]!.surface, 'chat');
      assert.equal(data.sankey[0]!.credits, 5);
    } finally { store.dispose(); }
  });

  it('model filter excludes non-matching events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    try {
      const now = Date.now();
      await store.writer.insert([
        makeEvent({ ts: now - 1000, credits: 5, modelId: 'gpt-4o' }),
        makeEvent({ ts: now - 2000, credits: 3, modelId: 'claude-sonnet-4-6' }),
      ]);
      const data = await store.reader.readFilteredSnapshot({ models: ['gpt-4o'] });
      assert.equal(data.totals.all.credits, 5);
      assert.equal(data.models.length, 1);
      assert.equal(data.models[0]!.modelId, 'gpt-4o');
    } finally { store.dispose(); }
  });

  it('dims use range-only filter so dropdowns remain populated', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    try {
      const now = Date.now();
      await store.writer.insert([
        makeEvent({ ts: now - 1000, credits: 5, modelId: 'gpt-4o' }),
        makeEvent({ ts: now - 2000, credits: 3, modelId: 'claude-sonnet-4-6' }),
      ]);
      // Filter by gpt-4o only — dims should still include both models (range-only)
      const data = await store.reader.readFilteredSnapshot({
        models: ['gpt-4o'],
        range:  { start: now - DAY_MS, end: now + DAY_MS },
      });
      assert.equal(data.totals.all.credits, 5); // only gpt-4o
      assert.ok(data.dims.models.includes('gpt-4o'));
      assert.ok(data.dims.models.includes('claude-sonnet-4-6')); // still in dims
    } finally { store.dispose(); }
  });

  it('branch filter restricts aggregation to matching branch', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    try {
      const now = Date.now();
      await store.writer.insert([
        makeEvent({ ts: now - 1000, credits: 4, branch: 'main' }),
        makeEvent({ ts: now - 2000, credits: 2, branch: 'feature/x' }),
      ]);
      const data = await store.reader.readFilteredSnapshot({ branches: ['main'] });
      assert.equal(data.totals.all.credits, 4);
      assert.equal(data.models[0]!.credits, 4);
    } finally { store.dispose(); }
  });

  it('today totals match events timestamped today', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    try {
      const now = Date.now();
      const todayStart = startOf(now, 'day');
      await store.writer.insert([
        makeEvent({ ts: todayStart + 1000, credits: 3 }),
        makeEvent({ ts: todayStart - DAY_MS, credits: 7 }), // yesterday
      ]);
      const data = await store.reader.readFilteredSnapshot({});
      assert.equal(data.totals.all.credits, 10);
      assert.equal(data.totals.today.credits, 3);
    } finally { store.dispose(); }
  });

  it('category breakdown populated from costByCategory JSON', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    try {
      const now = Date.now();
      await store.writer.insert([
        makeEvent({
          ts: now - 1000, credits: 2, cost: 0.10,
          costByCategory: { input: 0.07, output: 0.03 },
        }),
      ]);
      const data = await store.reader.readFilteredSnapshot({});
      const catMap = new Map(data.categories.map((c) => [c.category, c.cost]));
      assert.ok((catMap.get('input') ?? 0) > 0);
      assert.ok((catMap.get('output') ?? 0) > 0);
      assert.ok(!catMap.has('tool')); // absent if zero
    } finally { store.dispose(); }
  });

  it('hourly distribution groups credits by hour of day', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    try {
      const now = Date.now();
      await store.writer.insert([
        makeEvent({ ts: now - 1000, credits: 5 }),
      ]);
      const data = await store.reader.readFilteredSnapshot({});
      const totalHourly = data.hourly.reduce((s, h) => s + h.credits, 0);
      assert.equal(totalHourly, 5);
      assert.ok(data.hourly.every((h) => h.hourLocal >= 0 && h.hourLocal < 24));
    } finally { store.dispose(); }
  });

  it('NULL repo appears as "unattributed" in topRepos and dims', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    try {
      const now = Date.now();
      await store.writer.insert([
        makeEvent({ ts: now - 1000, credits: 3, repo: 'octo/a' }),
        makeEvent({ ts: now - 2000, credits: 2 }), // no repo
      ]);
      const data = await store.reader.readFilteredSnapshot({});
      const repoKeys = data.repos.map((r) => r.repo);
      assert.ok(repoKeys.includes('octo/a'));
      assert.ok(repoKeys.includes('unattributed'));
      assert.ok(data.dims.repos.includes('unattributed'));
    } finally { store.dispose(); }
  });

  it('daily buckets have DST-correct epoch-ms day_start values', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    try {
      const now = Date.now();
      const today = startOf(now, 'day');
      const yesterday = startOf(now - DAY_MS, 'day');
      await store.writer.insert([
        makeEvent({ ts: today + 1000,     credits: 3 }),
        makeEvent({ ts: yesterday + 1000, credits: 5 }),
      ]);
      const data = await store.reader.readFilteredSnapshot({});
      assert.equal(data.daily.length, 2);
      // day_start values should be multiples of DAY_MS (midnight UTC)
      for (const d of data.daily) {
        assert.equal(d.dayStart % (60 * 1000), 0, 'day_start should be minute-aligned');
      }
      const credits = data.daily.map((d) => d.credits).sort((a, b) => b - a);
      assert.equal(credits[0], 5);
      assert.equal(credits[1], 3);
    } finally { store.dispose(); }
  });

  it('sankey excludes zero-credit events', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    try {
      const now = Date.now();
      await store.writer.insert([
        makeEvent({ ts: now - 1000, credits: 0, modelId: 'gpt-4o', surface: 'chat' }),
        makeEvent({ ts: now - 2000, credits: 2, modelId: 'gpt-4o', surface: 'chat' }),
      ]);
      const data = await store.reader.readFilteredSnapshot({});
      assert.equal(data.sankey.length, 1);
      assert.equal(data.sankey[0]!.credits, 2);
    } finally { store.dispose(); }
  });

  it('surface filter restricts totals correctly', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    try {
      const now = Date.now();
      await store.writer.insert([
        makeEvent({ ts: now - 1000, credits: 4, surface: 'chat' }),
        makeEvent({ ts: now - 2000, credits: 6, surface: 'agent' }),
      ]);
      const data = await store.reader.readFilteredSnapshot({ surfaces: ['chat'] });
      assert.equal(data.totals.all.credits, 4);
    } finally { store.dispose(); }
  });
});
