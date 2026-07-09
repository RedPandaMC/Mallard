import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventStore } from '../../../src/extension-backend/store/EventStore';
import { DAY_MS, startOf } from '../../../src/extension-backend/util/time';
import { makeEvent } from '../helpers';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mallard-parity-'));
}

/**
 * Migration safety net for the single-engine snapshot refactor: the no-filter
 * cache path (readSnapshotCache) must produce exactly the same SnapshotSourceData
 * as the live aggregation with an empty filter (readFilteredSnapshot({})). If
 * these ever diverge, the dashboard shows different numbers for the same data
 * depending only on whether a filter is active.
 */
describe('snapshot engine parity: cache ≡ filtered({})', () => {
  it('produces identical SnapshotSourceData for a seeded dataset', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    try {
      const today = startOf(Date.now(), 'day') + 10 * 3_600_000;
      await store.writer.insert([
        makeEvent({ id: 'a', ts: today, credits: 5, cost: 0.2, modelId: 'gpt-4o', surface: 'chat', source: 'local', repo: 'octo/a', promptTokens: 100, completionTokens: 50 }),
        makeEvent({ id: 'b', ts: today - 2 * DAY_MS, credits: 3, cost: 0.12, modelId: 'claude-sonnet-4', surface: 'agent', source: 'claude-code', repo: 'octo/b', promptTokens: 80, completionTokens: 40 }),
        makeEvent({ id: 'c', ts: today - 40 * DAY_MS, credits: 8, cost: 0.33, modelId: 'gpt-4o', surface: 'chat', source: 'local', promptTokens: 200, completionTokens: 90, estimated: true }),
        makeEvent({ id: 'd', ts: today - 5 * DAY_MS, credits: 2, cost: 0.08, modelId: 'gpt-4o-mini', surface: 'inline', source: 'local', repo: 'octo/a' }),
      ]);

      const cache = await store.reader.readSnapshotCache();
      const filtered = await store.reader.readFilteredSnapshot({});

      // Compare values independent of list ordering: the two engines agree on
      // every number today, differing only in the order of some dimension and
      // sankey lists. Sorting normalises that so the test guards the numbers
      // (the thing that must never drift) without pinning an incidental order.
      const norm = (d: unknown) => {
        const o = JSON.parse(JSON.stringify(d));
        o.dims.models.sort();
        o.dims.surfaces.sort();
        o.dims.sources.sort();
        o.dims.repos.sort();
        const key = (r: Record<string, unknown>) => JSON.stringify(r);
        o.sankey.sort((a: Record<string, unknown>, b: Record<string, unknown>) => key(a).localeCompare(key(b)));
        o.models.sort((a: Record<string, unknown>, b: Record<string, unknown>) => key(a).localeCompare(key(b)));
        o.repos.sort((a: Record<string, unknown>, b: Record<string, unknown>) => key(a).localeCompare(key(b)));
        return o;
      };

      assert.deepStrictEqual(
        norm(cache),
        norm(filtered),
        'the cache path and the empty-filter live path must agree on every value',
      );
    } finally {
      store.dispose();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
