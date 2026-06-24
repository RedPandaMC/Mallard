import type { DuckDBConnection } from '@duckdb/node-api';
import { readPrepared, runPrepared } from './dbUtils';
import { META_GET_SQL, META_SET_SQL } from './schema';

export interface IMetaStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export class MetaStore implements IMetaStore {
  constructor(private readonly conn: DuckDBConnection) {}

  async get(key: string): Promise<string | null> {
    const rows = await readPrepared(
      this.conn,
      META_GET_SQL,
      [key],
      /* c8 ignore next */
      (r) => String(r['value'] ?? ''),
    );
    return rows[0] ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await runPrepared(this.conn, META_SET_SQL, [key, value]);
  /* c8 ignore next */
  }
/* c8 ignore next */
}
