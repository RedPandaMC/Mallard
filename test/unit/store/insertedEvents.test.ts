import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventStore } from '../../../src/extension-backend/store/EventStore';
import { UsageEvent } from '../../../src/extension-backend/domain/types';
import { makeEvent } from '../helpers';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mallard-inserted-'));
}

describe('EventWriter.onInserted — the streaming delta hook', () => {
  it('reports exactly the events that survived the merge', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    try {
      const batches: UsageEvent[][] = [];
      store.writer.onInserted = (events) => batches.push(events);
      const now = Date.now();

      await store.writer.insert([
        makeEvent({ id: 's1', ts: now - 1000 }),
        makeEvent({ id: 's2', ts: now - 2000 }),
      ]);
      assert.equal(batches.length, 1);
      assert.deepEqual(batches[0]!.map((e) => e.id).sort(), ['s1', 's2']);

      // Re-read of the same rows plus one genuinely new one: only the new
      // event streams — INSERT OR IGNORE re-reads must never re-send.
      await store.writer.insert([
        makeEvent({ id: 's1', ts: now - 1000 }),
        makeEvent({ id: 's3', ts: now - 500 }),
      ]);
      assert.equal(batches.length, 2);
      assert.deepEqual(batches[1]!.map((e) => e.id), ['s3']);
    } finally { store.dispose(); }
  });

  it('collapses in-batch duplicates (first occurrence wins) and skips empty deltas', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    try {
      const batches: UsageEvent[][] = [];
      store.writer.onInserted = (events) => batches.push(events);
      const now = Date.now();

      await store.writer.insert([
        makeEvent({ id: 'dup', ts: now - 1000, credits: 7 }),
        makeEvent({ id: 'dup', ts: now - 1000, credits: 9 }),
      ]);
      assert.equal(batches.length, 1);
      assert.equal(batches[0]!.length, 1);
      assert.equal(batches[0]![0]!.credits, 7);

      // Nothing new — the hook must not fire at all.
      await store.writer.insert([makeEvent({ id: 'dup', ts: now - 1000 })]);
      assert.equal(batches.length, 1);
    } finally { store.dispose(); }
  });
});
