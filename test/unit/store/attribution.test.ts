import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventStore } from '../../../src/extension-backend/store/EventStore';
import { makeEvent } from '../helpers';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mallard-attribution-'));
}

describe('repo attribution storage', () => {
  it('round-trips the attribution column through insert and find', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    try {
      const now = Date.now();
      await store.writer.insert([
        makeEvent({ id: 'a1', ts: now - 1000, repo: 'org/one', attribution: 'heuristic' }),
        makeEvent({ id: 'a2', ts: now - 2000, repo: 'proj', attribution: 'authoritative' }),
        makeEvent({ id: 'a3', ts: now - 3000 }),
      ]);
      const all = await store.reader.find();
      const byId = new Map(all.map((e) => [e.id, e]));
      assert.equal(byId.get('a1')?.attribution, 'heuristic');
      assert.equal(byId.get('a2')?.attribution, 'authoritative');
      assert.equal(byId.get('a3')?.attribution, undefined);
      assert.equal(byId.get('a3')?.repo, undefined);
    } finally { store.dispose(); }
  });

  it('never relabels an existing row on a later pass (INSERT OR IGNORE)', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    try {
      const now = Date.now();
      // First pass: backfill — the row lands unattributed.
      await store.writer.insert([makeEvent({ id: 'same-id', ts: now - 1000 })]);
      // Second pass re-reads the same source row, this time with a live
      // heuristic ctx. The dedup id must win: no silent relabeling.
      await store.writer.insert([
        makeEvent({ id: 'same-id', ts: now - 1000, repo: 'org/focused', attribution: 'heuristic' }),
      ]);
      const row = await store.reader.findById('same-id');
      assert.equal(row?.repo, undefined);
      assert.equal(row?.attribution, undefined);
    } finally { store.dispose(); }
  });

  it('reports the per-repo heuristic cost share in the snapshot', async () => {
    const dir = await tmpDir();
    const store = await EventStore.open(dir);
    try {
      const now = Date.now();
      await store.writer.insert([
        makeEvent({ id: 'h1', ts: now - 1000, repo: 'mixed', cost: 3, attribution: 'heuristic' }),
        makeEvent({ id: 'h2', ts: now - 2000, repo: 'mixed', cost: 1, attribution: 'authoritative' }),
        makeEvent({ id: 'h3', ts: now - 3000, repo: 'clean', cost: 2, attribution: 'authoritative' }),
        makeEvent({ id: 'h4', ts: now - 4000, cost: 5 }),
      ]);
      const data = await store.reader.readFilteredSnapshot({});
      const byRepo = new Map(data.repos.map((r) => [r.repo, r]));
      assert.equal(byRepo.get('mixed')?.heuristicShare, 0.75);
      assert.equal(byRepo.get('clean')?.heuristicShare, 0);
      assert.equal(byRepo.get('unattributed')?.heuristicShare, 0);
    } finally { store.dispose(); }
  });

});
