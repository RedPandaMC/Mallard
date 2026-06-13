/**
 * Per-user event store backed by DuckDB (embedded, via the N-API bindings).
 *
 * DuckDB persists to a single `events.duckdb` file, so history survives restarts
 * and is loaded instantly without re-ingesting logs. The bindings use N-API,
 * which is ABI-stable across Node and VS Code's Electron host, so there is no
 * native module to rebuild. A small `meta` table persists the log read offsets
 * so the watcher resumes where it left off.
 *
 * Raw per-request events are kept for a recent window; older events are rolled
 * up into coarse daily rows to keep the file bounded.
 */
import { mkdirSync } from 'fs';
import * as path from 'path';
import { DuckDBConnection, DuckDBInstance, DuckDBPreparedStatement } from '@duckdb/node-api';
import { CostCategory, Filter, SourceKind, Surface, UsageEvent } from '../domain/types';
import { UNATTRIBUTED_REPO } from '../domain/aggregate';
import { DAY_MS, startOf } from '../util/time';
import { MAX_RAW_EVENTS, RAW_WINDOW_DAYS } from './schema';

type Categories = Partial<Record<CostCategory, number>>;

/** Sum two optional category maps; returns undefined when both are absent. */
function addCategories(a?: Categories, b?: Categories): Categories | undefined {
  if (!a && !b) return undefined;
  const out: Categories = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {})) {
    out[k as CostCategory] = (out[k as CostCategory] ?? 0) + (v ?? 0);
  }
  return out;
}

/** Collapse old per-request events into one row per day/model/repo/surface. */
export function rollupEvents(old: UsageEvent[]): UsageEvent[] {
  const map = new Map<string, UsageEvent>();
  for (const e of old) {
    const day = startOf(e.ts, 'day');
    const key = `roll:${day}:${e.modelId}:${e.repo ?? UNATTRIBUTED_REPO}:${e.surface}`;
    const existing = map.get(key);
    if (existing) {
      existing.credits += e.credits;
      existing.cost += e.cost;
      existing.promptTokens = (existing.promptTokens ?? 0) + (e.promptTokens ?? 0);
      existing.completionTokens = (existing.completionTokens ?? 0) + (e.completionTokens ?? 0);
      const merged = addCategories(existing.costByCategory, e.costByCategory);
      if (merged) existing.costByCategory = merged;
    } else {
      map.set(key, { ...e, id: key, ts: day, estimated: true });
    }
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS events (
    id VARCHAR PRIMARY KEY,
    ts BIGINT NOT NULL,
    modelId VARCHAR NOT NULL,
    surface VARCHAR NOT NULL,
    source VARCHAR NOT NULL,
    credits DOUBLE NOT NULL,
    cost DOUBLE NOT NULL,
    promptTokens INTEGER,
    completionTokens INTEGER,
    estimated BOOLEAN NOT NULL DEFAULT TRUE,
    repo VARCHAR,
    costByCategory VARCHAR
  );
  CREATE INDEX IF NOT EXISTS idx_ts ON events(ts);
  CREATE INDEX IF NOT EXISTS idx_model ON events(modelId);
  CREATE TABLE IF NOT EXISTS meta (key VARCHAR PRIMARY KEY, value VARCHAR);
`;

const INSERT_SQL = `INSERT OR IGNORE INTO events
  (id, ts, modelId, surface, source, credits, cost, promptTokens, completionTokens, estimated, repo, costByCategory)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`;

type Row = Record<string, unknown>;

function rowToEvent(row: Row): UsageEvent {
  let costByCategory: Categories | undefined;
  if (typeof row.costByCategory === 'string') {
    try {
      costByCategory = JSON.parse(row.costByCategory) as Categories;
    } catch {
      costByCategory = undefined;
    }
  }
  return {
    id: String(row.id),
    ts: Number(row.ts),
    modelId: String(row.modelId),
    surface: row.surface as Surface,
    source: row.source as SourceKind,
    credits: Number(row.credits),
    cost: Number(row.cost),
    estimated: row.estimated !== false,
    ...(row.promptTokens != null ? { promptTokens: Number(row.promptTokens) } : {}),
    ...(row.completionTokens != null ? { completionTokens: Number(row.completionTokens) } : {}),
    ...(typeof row.repo === 'string' ? { repo: row.repo } : {}),
    ...(costByCategory !== undefined ? { costByCategory } : {}),
  };
}

export class EventStore {
  private constructor(
    private readonly instance: DuckDBInstance,
    private readonly conn: DuckDBConnection,
  ) {}

  /** Open (or create) the persistent database. */
  static async open(dir: string): Promise<EventStore> {
    mkdirSync(dir, { recursive: true });
    const instance = await DuckDBInstance.create(path.join(dir, 'events.duckdb'));
    const conn = await instance.connect();
    const store = new EventStore(instance, conn);
    await conn.run(CREATE_SQL);
    return store;
  }

  /** No-op — opening is done in {@link open}. Kept for API compatibility. */
  async load(): Promise<void> {
    /* noop */
  }

  async all(): Promise<UsageEvent[]> {
    return this.select('SELECT * FROM events ORDER BY ts');
  }

  async count(): Promise<number> {
    const rows = (await this.conn.runAndReadAll('SELECT count(*) AS c FROM events')).getRowObjects();
    return Number(rows[0]?.c ?? 0);
  }

  async append(incoming: UsageEvent[]): Promise<number> {
    if (incoming.length === 0) return 0;
    const before = await this.count();
    await this.insertAll(incoming);
    const added = (await this.count()) - before;
    if ((await this.count()) > MAX_RAW_EVENTS) await this.rollup();
    return added;
  }

  async query(filter?: Filter): Promise<UsageEvent[]> {
    if (!filter) return this.select('SELECT * FROM events ORDER BY ts');

    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter.range) {
      clauses.push('ts >= ? AND ts < ?');
      params.push(filter.range.start, filter.range.end);
    }
    if (filter.models?.length) {
      clauses.push(`modelId IN (${filter.models.map(() => '?').join(',')})`);
      params.push(...filter.models);
    }
    if (filter.surfaces?.length) {
      clauses.push(`surface IN (${filter.surfaces.map(() => '?').join(',')})`);
      params.push(...filter.surfaces);
    }
    if (filter.repos?.length) {
      // Unattributed events store a NULL repo; match them via the sentinel.
      const named = filter.repos.filter((r) => r !== UNATTRIBUTED_REPO);
      const parts: string[] = [];
      if (named.length) {
        parts.push(`repo IN (${named.map(() => '?').join(',')})`);
        params.push(...named);
      }
      if (filter.repos.includes(UNATTRIBUTED_REPO)) parts.push('repo IS NULL');
      if (parts.length) clauses.push(`(${parts.join(' OR ')})`);
    }

    if (clauses.length === 0) return this.select('SELECT * FROM events ORDER BY ts');
    return this.select(`SELECT * FROM events WHERE ${clauses.join(' AND ')} ORDER BY ts`, params);
  }

  async rollup(now = Date.now()): Promise<void> {
    const cutoff = startOf(now - RAW_WINDOW_DAYS * DAY_MS, 'day');
    const old = await this.select('SELECT * FROM events WHERE ts < ? ORDER BY ts', [cutoff]);
    if (old.length === 0) return;
    const rolled = rollupEvents(old);
    const del = await this.conn.prepare('DELETE FROM events WHERE ts < ?');
    del.bindBigInt(1, BigInt(cutoff));
    await del.run();
    await this.insertAll(rolled);
  }

  async clear(): Promise<void> {
    await this.conn.run('DELETE FROM events');
    await this.conn.run('DELETE FROM meta');
  }

  async export(): Promise<string> {
    return JSON.stringify(await this.all(), null, 2);
  }

  /** Read a persisted meta value (used for log read offsets). */
  async getMeta(key: string): Promise<string | undefined> {
    const prep = await this.conn.prepare('SELECT value FROM meta WHERE key = ?');
    prep.bindVarchar(1, key);
    const rows = (await prep.runAndReadAll()).getRowObjects();
    const v = rows[0]?.value;
    return typeof v === 'string' ? v : undefined;
  }

  async setMeta(key: string, value: string): Promise<void> {
    const prep = await this.conn.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
    prep.bindVarchar(1, key);
    prep.bindVarchar(2, value);
    await prep.run();
  }

  dispose(): void {
    this.conn.closeSync();
    this.instance.closeSync();
  }

  /** Bulk insert with dedup (INSERT OR IGNORE) inside a single transaction. */
  private async insertAll(events: UsageEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.conn.run('BEGIN');
    try {
      const stmt = await this.conn.prepare(INSERT_SQL);
      for (const e of events) {
        bindEvent(stmt, e);
        await stmt.run();
      }
      await this.conn.run('COMMIT');
    } catch (err) {
      await this.conn.run('ROLLBACK');
      throw err;
    }
  }

  private async select(sql: string, params: unknown[] = []): Promise<UsageEvent[]> {
    if (params.length === 0) {
      return (await this.conn.runAndReadAll(sql)).getRowObjects().map((r) => rowToEvent(r as Row));
    }
    const prep = await this.conn.prepare(sql);
    params.forEach((p, i) => bindParam(prep, i + 1, p));
    return (await prep.runAndReadAll()).getRowObjects().map((r) => rowToEvent(r as Row));
  }
}

/** Bind one positional parameter, choosing the DuckDB type from the JS value. */
function bindParam(stmt: DuckDBPreparedStatement, i: number, v: unknown): void {
  if (v === null || v === undefined) stmt.bindNull(i);
  else if (typeof v === 'number') stmt.bindBigInt(i, BigInt(Math.trunc(v)));
  else stmt.bindVarchar(i, String(v));
}

function bindEvent(stmt: DuckDBPreparedStatement, e: UsageEvent): void {
  stmt.bindVarchar(1, e.id);
  stmt.bindBigInt(2, BigInt(e.ts));
  stmt.bindVarchar(3, e.modelId);
  stmt.bindVarchar(4, e.surface);
  stmt.bindVarchar(5, e.source);
  stmt.bindDouble(6, e.credits);
  stmt.bindDouble(7, e.cost);
  if (e.promptTokens != null) stmt.bindInteger(8, e.promptTokens);
  else stmt.bindNull(8);
  if (e.completionTokens != null) stmt.bindInteger(9, e.completionTokens);
  else stmt.bindNull(9);
  stmt.bindBoolean(10, e.estimated);
  if (e.repo != null) stmt.bindVarchar(11, e.repo);
  else stmt.bindNull(11);
  if (e.costByCategory) stmt.bindVarchar(12, JSON.stringify(e.costByCategory));
  else stmt.bindNull(12);
}
