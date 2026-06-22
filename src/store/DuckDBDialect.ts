/* c8 ignore start */
/**
 * Thin Kysely dialect adapter for @duckdb/node-api.
 *
 * Uses SqliteQueryCompiler because DuckDB accepts ?-parameterized SQL and
 * INSERT OR IGNORE / OR REPLACE — identical to SQLite's dialect.
 *
 * Analytics queries (PERCENTILE_CONT, strftime, dayofweek) use Kysely's
 * sql`` tagged template and bypass the query builder entirely.
 */
import {
  CompiledQuery,
  DatabaseConnection,
  DatabaseIntrospector,
  Dialect,
  DialectAdapter,
  Driver,
  Kysely,
  QueryCompiler,
  QueryResult,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from 'kysely';
import type {
  DuckDBConnection,
  DuckDBPreparedStatement,
} from '@duckdb/node-api';
/* c8 ignore stop */

// ── Database schema type map ──────────────────────────────────────────────────

export interface EventsTable {
  id: string;
  ts: number;
  modelId: string;
  surface: string;
  source: string;
  credits: number;
  cost: number;
  promptTokens: number | null;
  completionTokens: number | null;
  estimated: number;
  repo: string | null;
  costByCategory: string | null;
  branch: string | null;
}

export interface MetaTable {
  key: string;
  value: string;
}

export interface DB {
  events: EventsTable;
  meta: MetaTable;
}

// ── Parameter binding ─────────────────────────────────────────────────────────

function bindKyselyParam(stmt: DuckDBPreparedStatement, i: number, v: unknown): void {
  if (v === null || v === undefined) {
    stmt.bindNull(i);
  /* c8 ignore next 2 */
  } else if (typeof v === 'boolean') {
    stmt.bindBoolean(i, v);
  /* c8 ignore next 2 */
  } else if (typeof v === 'bigint') {
    stmt.bindBigInt(i, v);
  } else if (typeof v === 'number') {
    if (Number.isInteger(v)) {
      stmt.bindBigInt(i, BigInt(Math.trunc(v)));
    } else {
      stmt.bindDouble(i, v);
    }
  } else {
    stmt.bindVarchar(i, String(v));
  }
}

// ── DatabaseConnection ────────────────────────────────────────────────────────

class DuckDBKyselyConnection implements DatabaseConnection {
  constructor(private readonly conn: DuckDBConnection) {}

  async executeQuery<O>(q: CompiledQuery): Promise<QueryResult<O>> {
    if (q.parameters.length === 0) {
      const rows = (await this.conn.runAndReadAll(q.sql)).getRowObjects() as O[];
      return { rows };
    }
    const stmt = await this.conn.prepare(q.sql);
    q.parameters.forEach((p, i) => bindKyselyParam(stmt, i + 1, p));
    const rows = (await stmt.runAndReadAll()).getRowObjects() as O[];
    return { rows };
  }

  /* c8 ignore next 3 */
  streamQuery<O>(): AsyncIterableIterator<QueryResult<O>> {
    throw new Error('DuckDB dialect does not support streaming queries');
  }
}

// ── Driver ────────────────────────────────────────────────────────────────────

class DuckDBDriver implements Driver {
  private readonly dbConn: DuckDBKyselyConnection;

  constructor(conn: DuckDBConnection) {
    this.dbConn = new DuckDBKyselyConnection(conn);
  }

  async init(): Promise<void> { /* no-op: EventStore owns lifecycle */ }
  /* c8 ignore next */
  async destroy(): Promise<void> { /* no-op: EventStore owns lifecycle */ }
  async acquireConnection(): Promise<DuckDBKyselyConnection> { return this.dbConn; }
  async releaseConnection(): Promise<void> { /* no-op: single shared connection */ }

  async beginTransaction(conn: DuckDBKyselyConnection): Promise<void> {
    await (conn as unknown as { conn: DuckDBConnection }).conn.run('BEGIN');
  }

  async commitTransaction(conn: DuckDBKyselyConnection): Promise<void> {
    await (conn as unknown as { conn: DuckDBConnection }).conn.run('COMMIT');
  }

  /* c8 ignore next 3 */
  async rollbackTransaction(conn: DuckDBKyselyConnection): Promise<void> {
    await (conn as unknown as { conn: DuckDBConnection }).conn.run('ROLLBACK');
  }
}

// ── Dialect factory ───────────────────────────────────────────────────────────

/* c8 ignore next */
export function makeDuckDBDialect(conn: DuckDBConnection): Dialect {
  return {
    createAdapter:       (): DialectAdapter        => new SqliteAdapter(),
    createDriver:        (): Driver                 => new DuckDBDriver(conn),
    createIntrospector:  (db: Kysely<unknown>): DatabaseIntrospector => new SqliteIntrospector(db),
    createQueryCompiler: (): QueryCompiler          => new SqliteQueryCompiler(),
  };
}
