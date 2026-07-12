import { strict as assert } from 'assert';
import { runMigrations } from '../../../src/extension-backend/store/migrations';
import { baseline } from '../../../src/extension-backend/store/migrations/0005-baseline';
import { DB_META_SCHEMA_VERSION_KEY, STORE_SCHEMA_VERSION } from '../../../src/extension-backend/store/schema/constants';
import type { IMetaStore } from '../../../src/extension-backend/store/MetaStore';

function makeMeta(initial?: string): IMetaStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(DB_META_SCHEMA_VERSION_KEY, initial);
  return {
    values,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => void values.set(key, value),
  };
}

// runMigrations only hands `conn` to Migration.up; the current baseline never
// touches it, so a bare object suffices and a real DB isn't needed.
const conn = {} as never;

describe('store migrations — runMigrations', () => {
  it('the registered baseline matches the exported schema version', () => {
    assert.equal(baseline.version, STORE_SCHEMA_VERSION);
  });

  it('stamps a fresh (unversioned) database up to the current version', async () => {
    const meta = makeMeta();
    await runMigrations(conn, meta);
    assert.equal(meta.values.get(DB_META_SCHEMA_VERSION_KEY), String(STORE_SCHEMA_VERSION));
  });

  it('migrates a pre-baseline database and records each applied version', async () => {
    const meta = makeMeta('3');
    await runMigrations(conn, meta);
    assert.equal(meta.values.get(DB_META_SCHEMA_VERSION_KEY), String(STORE_SCHEMA_VERSION));
  });

  it('is a no-op when the database is already at the current version', async () => {
    const meta = makeMeta(String(STORE_SCHEMA_VERSION));
    const before = new Map(meta.values);
    await runMigrations(conn, meta);
    assert.deepEqual([...meta.values], [...before], 'no writes when up to date');
  });

  it('never downgrades a database stamped at a future version', async () => {
    const meta = makeMeta(String(STORE_SCHEMA_VERSION + 2));
    await runMigrations(conn, meta);
    assert.equal(
      meta.values.get(DB_META_SCHEMA_VERSION_KEY),
      String(STORE_SCHEMA_VERSION + 2),
      'future stamp preserved, no migration re-applied',
    );
  });

  it('is idempotent — a second run makes no further changes', async () => {
    const meta = makeMeta();
    await runMigrations(conn, meta);
    const after = new Map(meta.values);
    await runMigrations(conn, meta);
    assert.deepEqual([...meta.values], [...after]);
  });
});
