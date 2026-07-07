import type { DuckDBConnection } from '@duckdb/node-api';
import type { IMetaStore } from '../MetaStore';
import { DB_META_SCHEMA_VERSION_KEY } from '../schema/constants';
import type { Migration } from './types';
import { baseline } from './0005-baseline';
import { attribution } from './0006-attribution';

const MIGRATIONS: Migration[] = [baseline, attribution];

export async function runMigrations(conn: DuckDBConnection, meta: IMetaStore): Promise<void> {
  const stored = parseInt((await meta.get(DB_META_SCHEMA_VERSION_KEY)) ?? '0', 10);
  const pending = MIGRATIONS.filter((m) => m.version > stored);
  for (const m of pending) {
    await m.up(conn);
    await meta.set(DB_META_SCHEMA_VERSION_KEY, String(m.version));
  }
}
