import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { cleanupStorage, cleanupGlobalState } from '../../../src/extension-backend/app/Lifecycle';
import type { Memento } from 'vscode';

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mallard-lifecycle-test-'));
}

describe('cleanupStorage()', () => {
  it('deletes events.duckdb when it exists', async () => {
    const dir = await makeTmpDir();
    const dbPath = path.join(dir, 'events.duckdb');
    await fs.writeFile(dbPath, '');
    await cleanupStorage(dir);
    await assert.rejects(fs.access(dbPath), 'file should be gone');
  });

  it('deletes events.duckdb.wal when it exists', async () => {
    const dir = await makeTmpDir();
    const walPath = path.join(dir, 'events.duckdb.wal');
    await fs.writeFile(walPath, '');
    await cleanupStorage(dir);
    await assert.rejects(fs.access(walPath), 'wal file should be gone');
  });

  it('does not throw when neither file exists', async () => {
    const dir = await makeTmpDir();
    await assert.doesNotReject(cleanupStorage(dir));
  });

  it('does not throw when only one file is absent', async () => {
    const dir = await makeTmpDir();
    await fs.writeFile(path.join(dir, 'events.duckdb'), '');
    // wal is absent — must not throw
    await assert.doesNotReject(cleanupStorage(dir));
  });
});

describe('cleanupGlobalState()', () => {
  it('calls update(key, undefined) for every key returned by keys()', async () => {
    const updates: Array<[string, undefined]> = [];
    const memento = {
      keys: () => ['watermark:a', 'watermark:b', 'schema-version'],
      update: async (k: string, v: undefined) => { updates.push([k, v]); },
    } as unknown as Memento;

    await cleanupGlobalState(memento);

    assert.equal(updates.length, 3);
    assert.deepEqual(updates[0], ['watermark:a', undefined]);
    assert.deepEqual(updates[1], ['watermark:b', undefined]);
    assert.deepEqual(updates[2], ['schema-version', undefined]);
  });

  it('does nothing when keys() returns an empty array', async () => {
    let called = false;
    const memento = {
      keys: () => [],
      update: async () => { called = true; },
    } as unknown as Memento;

    await cleanupGlobalState(memento);
    assert.equal(called, false);
  });
});
