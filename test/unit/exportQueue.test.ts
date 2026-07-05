import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ExportQueue } from '../../src/extension-backend/export/ExportQueue';

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mallard-exportqueue-test-'));
}

describe('ExportQueue', () => {
  it('starts empty when no file exists on disk', async () => {
    const dir = await makeTmpDir();
    const queue = new ExportQueue(dir);
    assert.deepEqual(queue.peekAll(), []);
    await fs.rm(dir, { recursive: true });
  });

  it('enqueue then peekAll returns the entry with topic/payload/enqueuedAt', async () => {
    const dir = await makeTmpDir();
    const queue = new ExportQueue(dir);
    queue.enqueue('mallard/v3/metrics', { mtd_credits: 5 });
    const all = queue.peekAll();
    assert.equal(all.length, 1);
    assert.equal(all[0]!.topic, 'mallard/v3/metrics');
    assert.deepEqual(all[0]!.payload, { mtd_credits: 5 });
    assert.ok(typeof all[0]!.enqueuedAt === 'number');
    assert.ok(typeof all[0]!.id === 'string' && all[0]!.id.length > 0);
    await fs.rm(dir, { recursive: true });
  });

  it('enqueue preserves order across multiple entries', async () => {
    const dir = await makeTmpDir();
    const queue = new ExportQueue(dir);
    queue.enqueue('t', { n: 1 });
    queue.enqueue('t', { n: 2 });
    queue.enqueue('t', { n: 3 });
    const all = queue.peekAll();
    assert.deepEqual(all.map((e) => e.payload['n']), [1, 2, 3]);
    await fs.rm(dir, { recursive: true });
  });

  it('dequeue removes only the matching entry', async () => {
    const dir = await makeTmpDir();
    const queue = new ExportQueue(dir);
    queue.enqueue('t', { n: 1 });
    queue.enqueue('t', { n: 2 });
    const toRemove = queue.peekAll()[0]!.id;
    queue.dequeue(toRemove);
    const remaining = queue.peekAll();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]!.payload['n'], 2);
    await fs.rm(dir, { recursive: true });
  });

  it('persists across instances (writeToDisk/readFromDisk round-trip)', async () => {
    const dir = await makeTmpDir();
    const first = new ExportQueue(dir);
    first.enqueue('t', { n: 1 });
    const second = new ExportQueue(dir);
    assert.equal(second.peekAll().length, 1);
    assert.equal(second.peekAll()[0]!.payload['n'], 1);
    await fs.rm(dir, { recursive: true });
  });

  it('caps at 500 entries, evicting the oldest first', async () => {
    const dir = await makeTmpDir();
    const queue = new ExportQueue(dir);
    for (let i = 0; i < 501; i++) queue.enqueue('t', { n: i });
    const all = queue.peekAll();
    assert.equal(all.length, 500);
    // entry 0 (the oldest) should have been evicted; entry 1 should now be first.
    assert.equal(all[0]!.payload['n'], 1);
    assert.equal(all[all.length - 1]!.payload['n'], 500);
    await fs.rm(dir, { recursive: true });
  });

  it('falls back to an empty queue when the on-disk file is corrupt', async () => {
    const dir = await makeTmpDir();
    await fs.writeFile(path.join(dir, 'export-queue.json'), 'not valid json{{{', 'utf8');
    const queue = new ExportQueue(dir);
    assert.deepEqual(queue.peekAll(), []);
    await fs.rm(dir, { recursive: true });
  });

  it('falls back to an empty queue when the on-disk file is valid JSON but not an array', async () => {
    const dir = await makeTmpDir();
    await fs.writeFile(path.join(dir, 'export-queue.json'), JSON.stringify({ not: 'an array' }), 'utf8');
    const queue = new ExportQueue(dir);
    assert.deepEqual(queue.peekAll(), []);
    await fs.rm(dir, { recursive: true });
  });
});
