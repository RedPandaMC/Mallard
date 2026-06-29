import type { DuckDBConnection } from '@duckdb/node-api';

export interface Migration {
  version: number;
  description: string;
  up(conn: DuckDBConnection): Promise<void>;
}
