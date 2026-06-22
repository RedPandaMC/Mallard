/* c8 ignore start */
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
import { z } from 'zod';
import { CompiledQuery, Insertable, Kysely } from 'kysely';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { Filter, SourceKind, Surface, UsageEvent } from '../domain/types';
import { UNATTRIBUTED_REPO } from '../domain/aggregate';
import { DAY_MS, startOf } from '../util/time';
import { MAX_RAW_EVENTS, RAW_WINDOW_DAYS } from './schema';
import {
  AggregateResult,
  BucketBy,
  CrossTab,
  EventRepository,
  RecordFilter,
  TimeBucket,
} from './EventRepository';
import { DB, EventsTable, makeDuckDBDialect } from './DuckDBDialect';
/* c8 ignore stop */

import { rollupEvents } from '../domain/rollup';

type Categories = Partial<Record<string, number>>;

const EventRow = z.object({
  id: z.string(),
  ts: z.union([z.number(), z.bigint()]).transform(Number),
  modelId: z.string(),
  surface: z.enum(['chat', 'inline', 'agent', 'edit', 'unknown']).catch('unknown'),
  source: z.enum(['lm', 'local', 'github', 'claude-code']).catch('local'),
  credits: z.number(),
  cost: z.number(),
  estimated: z.union([z.boolean(), z.number()]).transform(Boolean),
  promptTokens: z.number().nullish(),
  completionTokens: z.number().nullish(),
  repo: z.string().nullish(),
  branch: z.string().nullish(),
  costByCategory: z.string().nullish(),
});

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
    costByCategory VARCHAR,
    branch VARCHAR
  );
  CREATE INDEX IF NOT EXISTS idx_ts ON events(ts);
  CREATE INDEX IF NOT EXISTS idx_model ON events(modelId);
  CREATE INDEX IF NOT EXISTS idx_ts_model ON events(ts, modelId);
  CREATE TABLE IF NOT EXISTS meta (key VARCHAR PRIMARY KEY, value VARCHAR);
  ALTER TABLE events ADD COLUMN IF NOT EXISTS branch VARCHAR;
`;

type Row = Record<string, unknown>;

function rowToEvent(row: Row): UsageEvent | null {
  const result = EventRow.safeParse(row);
  /* c8 ignore next 4 */
  if (!result.success) {
    console.warn('[mallard] EventStore: skipping malformed row', result.error.issues[0]?.message, row);
    return null;
  }
  const r = result.data;
  let costByCategory: Categories | undefined;
  if (typeof r.costByCategory === 'string') {
    try {
      costByCategory = JSON.parse(r.costByCategory) as Categories;
    } catch {
      console.warn('[mallard] EventStore: malformed costByCategory JSON, ignoring', r.costByCategory);
      costByCategory = undefined;
    }
  }
  return {
    id: r.id,
    ts: r.ts,
    modelId: r.modelId,
    surface: r.surface as Surface,
    source: r.source as SourceKind,
    credits: r.credits,
    cost: r.cost,
    estimated: r.estimated,
    ...(r.promptTokens != null ? { promptTokens: r.promptTokens } : {}),
    ...(r.completionTokens != null ? { completionTokens: r.completionTokens } : {}),
    ...(r.repo != null ? { repo: r.repo } : {}),
    ...(r.branch != null ? { branch: r.branch } : {}),
    ...(costByCategory !== undefined ? { costByCategory } : {}),
  };
}

function eventToRow(e: UsageEvent): Insertable<EventsTable> {
  return {
    id: e.id,
    ts: e.ts,
    modelId: e.modelId,
    surface: e.surface,
    source: e.source,
    credits: e.credits,
    cost: e.cost,
    promptTokens: e.promptTokens ?? null,
    completionTokens: e.completionTokens ?? null,
    estimated: e.estimated ? 1 : 0,
    repo: e.repo ?? null,
    costByCategory: e.costByCategory ? JSON.stringify(e.costByCategory) : null,
    branch: e.branch ?? null,
  };
}

/** Apply a RecordFilter to a Kysely query builder (works for SELECT and DELETE). */
function applyFilter<T extends { where: (...args: unknown[]) => T }>(
  qb: T,
  f: RecordFilter,
): T {
  let q = qb as any;
  if (f.range)            q = q.where('ts', '>=', f.range.start).where('ts', '<', f.range.end);
  if (f.models?.length)   q = q.where('modelId', 'in', f.models);
  if (f.surfaces?.length) q = q.where('surface', 'in', f.surfaces);
  if (f.branches?.length) q = q.where('branch', 'in', f.branches);
  if (f.sources?.length)  q = q.where('source', 'in', f.sources);
  if (f.repos?.length) {
    const named = f.repos.filter((r) => r !== UNATTRIBUTED_REPO);
    q = q.where((eb: any) => {
      const parts: any[] = [];
      if (named.length) parts.push(eb('repo', 'in', named));
      if (f.repos!.includes(UNATTRIBUTED_REPO)) parts.push(eb('repo', 'is', null));
      return eb.or(parts);
    });
  }
  return q as T;
}

export class EventStore implements EventRepository {
  private constructor(
    private readonly instance: DuckDBInstance,
    private readonly conn: DuckDBConnection,
    private readonly db: Kysely<DB>,
  ) {}

  /** Open (or create) the persistent database. */
  static async open(dir: string): Promise<EventStore> {
    mkdirSync(dir, { recursive: true });
    const instance = await DuckDBInstance.create(path.join(dir, 'events.duckdb'));
    const conn = await instance.connect();
    const db = new Kysely<DB>({ dialect: makeDuckDBDialect(conn) });
    const store = new EventStore(instance, conn, db);
    await conn.run(CREATE_SQL);
    return store;
  }

  /** No-op — opening is done in {@link open}. Kept for API compatibility. */
  async load(): Promise<void> {
    /* noop */
  }

  // ── EventRepository: writes ──────────────────────────────────────────────────

  async insert(records: UsageEvent[]): Promise<number> {
    /* c8 ignore next */
    if (records.length === 0) return 0;
    const dupes = await this.countExistingIds(records.map((e) => e.id));
    await this.insertAll(records);
    const total = await this.count();
    /* c8 ignore next */
    if (total > MAX_RAW_EVENTS) await this.compact();
    return records.length - dupes;
  }

  /** @deprecated Use `insert()`. */
  async append(incoming: UsageEvent[]): Promise<number> {
    return this.insert(incoming);
  }

  // ── EventRepository: point reads ─────────────────────────────────────────────

  async findById(id: string): Promise<UsageEvent | null> {
    const row = await this.db
      .selectFrom('events')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return null;
    return rowToEvent(row as Row);
  }

  async find(filter?: RecordFilter): Promise<UsageEvent[]> {
    let qb = this.db.selectFrom('events').selectAll().orderBy('ts');
    if (filter) {
      qb = applyFilter(qb, filter);
      if (filter.limit)  qb = qb.limit(filter.limit);
      if (filter.offset) qb = qb.offset(filter.offset);
    }
    const rows = await qb.execute();
    return rows.map((r) => rowToEvent(r as Row)).filter((e): e is UsageEvent => e !== null);
  }

  /** @deprecated Use `find()`. */
  async query(filter?: Filter): Promise<UsageEvent[]> {
    return this.find(filter);
  }

  async count(filter?: RecordFilter): Promise<number> {
    let qb = this.db.selectFrom('events').select((eb) => eb.fn.countAll<number>().as('c'));
    if (filter) qb = applyFilter(qb, filter);
    const row = await qb.executeTakeFirst();
    /* c8 ignore next */
    return Number(row?.c ?? 0);
  }

  async exists(id: string): Promise<boolean> {
    const r = await this.findById(id);
    return r !== null;
  }

  async all(): Promise<UsageEvent[]> {
    return this.find();
  }

  // ── EventRepository: analytics ───────────────────────────────────────────────

  async aggregate(filter: RecordFilter, fields: string[]): Promise<AggregateResult> {
    const safe = fields.filter((f) => /^[a-zA-Z_]+$/.test(f));
    if (safe.length === 0) return emptyAggregate();

    const selects = safe.flatMap((f) => [
      `COALESCE(SUM(${f}), 0) AS sum_${f}`,
      `COALESCE(AVG(${f}), 0) AS mean_${f}`,
      `COALESCE(STDDEV_POP(${f}), 0) AS stddev_${f}`,
      `COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${f}), 0) AS p50_${f}`,
      `COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${f}), 0) AS p95_${f}`,
      `COALESCE(MIN(${f}), 0) AS min_${f}`,
      `COALESCE(MAX(${f}), 0) AS max_${f}`,
    ]);

    const { where, params } = buildWhereSql(filter);
    const querySql = `SELECT COUNT(*) AS total, ${selects.join(', ')} FROM events ${where}`;
    const rows = (await this.runAnalytics<Row>(querySql, params)).rows;
    /* c8 ignore next */
    const row = rows[0] ?? {};

    const out: AggregateResult = {
      /* c8 ignore next */
      count: Number(row['total'] ?? 0),
      sum: {}, mean: {}, stddev: {}, p50: {}, p95: {}, min: {}, max: {},
    };
    for (const f of safe) {
      /* c8 ignore start */
      out.sum[f]    = Number(row[`sum_${f}`]    ?? 0);
      out.mean[f]   = Number(row[`mean_${f}`]   ?? 0);
      out.stddev[f] = Number(row[`stddev_${f}`] ?? 0);
      out.p50[f]    = Number(row[`p50_${f}`]    ?? 0);
      out.p95[f]    = Number(row[`p95_${f}`]    ?? 0);
      out.min[f]    = Number(row[`min_${f}`]    ?? 0);
      out.max[f]    = Number(row[`max_${f}`]    ?? 0);
      /* c8 ignore stop */
    }
    return out;
  }

  async bucket(filter: RecordFilter, by: BucketBy): Promise<TimeBucket[]> {
    const { where, params } = buildWhereSql(filter);
    let keyExpr: string;
    switch (by) {
      case 'hour':
        keyExpr = "strftime(to_timestamp(ts / 1000), '%H')";
        break;
      case 'weekday':
        keyExpr = 'CAST(dayofweek(to_timestamp(ts / 1000)) AS VARCHAR)';
        break;
      case 'week':
        keyExpr = "strftime(date_trunc('week', to_timestamp(ts / 1000)), '%Y-%m-%d')";
        break;
      case 'month':
        keyExpr = "strftime(date_trunc('month', to_timestamp(ts / 1000)), '%Y-%m')";
        break;
      default:
        keyExpr = "strftime(to_timestamp(ts / 1000), '%Y-%m-%d')";
    }
    const querySql = `
      SELECT
        ${keyExpr} AS bucket_key,
        COALESCE(SUM(credits), 0)                          AS credits,
        COALESCE(SUM(cost), 0)                             AS cost,
        COALESCE(SUM(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0)), 0) AS tokens,
        COUNT(*)                                           AS event_count
      FROM events ${where}
      GROUP BY bucket_key
      ORDER BY bucket_key
    `;
    const rows = (await this.runAnalytics<Row>(querySql, params)).rows;
    /* c8 ignore start */
    return rows.map((r) => ({
      key: String(r['bucket_key'] ?? ''),
      values: {
        credits:     Number(r['credits']     ?? 0),
        cost:        Number(r['cost']        ?? 0),
        tokens:      Number(r['tokens']      ?? 0),
        event_count: Number(r['event_count'] ?? 0),
      },
    }));
    /* c8 ignore stop */
  }

  async pivot(filter: RecordFilter, on: string, value: string): Promise<CrossTab> {
    /* c8 ignore next 2 */
    const safeOn    = /^[a-zA-Z_]+$/.test(on)    ? on    : 'surface';
    const safeValue = /^[a-zA-Z_]+$/.test(value) ? value : 'credits';

    const { where, params } = buildWhereSql(filter);

    // Step 1: get distinct column values
    const colSql = `SELECT DISTINCT ${safeOn} AS col FROM events ${where} ORDER BY col`;
    const colRows = (await this.runAnalytics<Row>(colSql, params)).rows;
    /* c8 ignore next */
    const columnKeys = colRows.map((r) => String(r['col'] ?? '')).filter(Boolean);
    if (columnKeys.length === 0) return { rows: [], columnKeys: [] };

    // Step 2: cross-tab via conditional aggregation
    const pivotCols = columnKeys.map(
      (k) => `COALESCE(SUM(CASE WHEN ${safeOn} = '${k.replace(/'/g, "''")}' THEN ${safeValue} ELSE 0 END), 0) AS "${k}"`,
    );
    const pivotSql = `
      SELECT modelId, ${pivotCols.join(', ')}
      FROM events ${where}
      GROUP BY modelId
      ORDER BY SUM(${safeValue}) DESC
    `;
    const dataRows = (await this.runAnalytics<Row>(pivotSql, params)).rows;
    return {
      /* c8 ignore start */
      rows: dataRows.map((r) => {
        const row: Record<string, string | number> = { modelId: String(r['modelId'] ?? '') };
        for (const k of columnKeys) row[k] = Number(r[k] ?? 0);
        return row;
      }),
      /* c8 ignore stop */
      columnKeys,
    };
  }

  async rank(filter: RecordFilter, by: string, limit = 10): Promise<TimeBucket[]> {
    /* c8 ignore next */
    const safeBy = /^[a-zA-Z_]+$/.test(by) ? by : 'credits';
    const { where, params } = buildWhereSql(filter);
    const querySql = `
      SELECT
        modelId AS rank_key,
        COALESCE(SUM(credits), 0) AS credits,
        COALESCE(SUM(cost), 0)    AS cost,
        COALESCE(SUM(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0)), 0) AS tokens,
        COUNT(*) AS event_count
      FROM events ${where}
      GROUP BY modelId
      ORDER BY SUM(${safeBy}) DESC
      LIMIT ${limit}
    `;
    const rows = (await this.runAnalytics<Row>(querySql, params)).rows;
    /* c8 ignore start */
    return rows.map((r) => ({
      key: String(r['rank_key'] ?? ''),
      values: {
        credits:     Number(r['credits']     ?? 0),
        cost:        Number(r['cost']        ?? 0),
        tokens:      Number(r['tokens']      ?? 0),
        event_count: Number(r['event_count'] ?? 0),
      },
    }));
    /* c8 ignore stop */
  }

  // ── EventRepository: meta ────────────────────────────────────────────────────

  async getMeta(key: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('meta')
      .select('value')
      .where('key', '=', key)
      .executeTakeFirst();
    return typeof row?.value === 'string' ? row.value : null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db
      .insertInto('meta')
      .values({ key, value })
      .orReplace()
      .execute();
  }

  // ── EventRepository: maintenance ─────────────────────────────────────────────

  async remove(filter: RecordFilter): Promise<number> {
    const hasFilter = !!(
      filter.range ||
      filter.models?.length ||
      filter.surfaces?.length ||
      filter.branches?.length ||
      filter.sources?.length ||
      filter.repos?.length
    );
    if (!hasFilter) return 0;
    const before = await this.count();
    await applyFilter(this.db.deleteFrom('events'), filter).execute();
    const after = await this.count();
    return before - after;
  }

  async compact(now = Date.now()): Promise<void> {
    const cutoff = startOf(now - RAW_WINDOW_DAYS * DAY_MS, 'day');
    const rows = await this.db
      .selectFrom('events')
      .selectAll()
      .where('ts', '<', cutoff)
      .orderBy('ts')
      .execute();
    const old = rows.map((r) => rowToEvent(r as Row)).filter((e): e is UsageEvent => e !== null);
    if (old.length === 0) return;
    const rolled = rollupEvents(old);
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('events').where('ts', '<', cutoff).execute();
      await trx.insertInto('events').values(rolled.map(eventToRow)).orIgnore().execute();
    });
  }

  /** @deprecated Use `compact()`. */
  async rollup(now = Date.now()): Promise<void> {
    return this.compact(now);
  }

  async dump(): Promise<UsageEvent[]> {
    return this.find();
  }

  async clear(): Promise<void> {
    await this.db.deleteFrom('events').execute();
    await this.db.deleteFrom('meta').execute();
  }

  /** JSON string dump for the exportReport command. */
  async export(): Promise<string> {
    return JSON.stringify(await this.dump(), null, 2);
  }

  dispose(): void {
    this.conn.closeSync();
    this.instance.closeSync();
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /** Count how many of the given ids already exist (scoped query, not full scan). */
  private async countExistingIds(ids: string[]): Promise<number> {
    /* c8 ignore next */
    if (ids.length === 0) return 0;
    const row = await this.db
      .selectFrom('events')
      .select((eb) => eb.fn.countAll<number>().as('c'))
      .where('id', 'in', ids)
      .executeTakeFirst();
    /* c8 ignore next */
    return Number(row?.c ?? 0);
  }

  /** Bulk insert with dedup (INSERT OR IGNORE) — single multi-row statement. */
  private async insertAll(events: UsageEvent[]): Promise<void> {
    /* c8 ignore next */
    if (events.length === 0) return;
    await this.db
      .insertInto('events')
      .values(events.map(eventToRow))
      .orIgnore()
      .execute();
  }

  /** Run a raw analytics SQL string through the shared Kysely connection. */
  private async runAnalytics<O>(querySql: string, params: unknown[]): Promise<{ rows: O[] }> {
    return this.db.executeQuery<O>(CompiledQuery.raw(querySql, params));
  }
}

/* c8 ignore next */
function emptyAggregate(): AggregateResult {
  return { count: 0, sum: {}, mean: {}, stddev: {}, p50: {}, p95: {}, min: {}, max: {} };
}

/** Build a parameterized WHERE clause for analytics raw SQL. */
/* c8 ignore next */
function buildWhereSql(f: RecordFilter): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (f.range) {
    clauses.push('ts >= ? AND ts < ?');
    params.push(f.range.start, f.range.end);
  }
  if (f.models?.length) {
    clauses.push(`modelId IN (${f.models.map(() => '?').join(',')})`);
    params.push(...f.models);
  }
  if (f.surfaces?.length) {
    clauses.push(`surface IN (${f.surfaces.map(() => '?').join(',')})`);
    params.push(...f.surfaces);
  }
  if (f.repos?.length) {
    const named = f.repos.filter((r) => r !== UNATTRIBUTED_REPO);
    const parts: string[] = [];
    if (named.length) {
      parts.push(`repo IN (${named.map(() => '?').join(',')})`);
      params.push(...named);
    }
    if (f.repos.includes(UNATTRIBUTED_REPO)) parts.push('repo IS NULL');
    if (parts.length) clauses.push(`(${parts.join(' OR ')})`);
  }
  if (f.branches?.length) {
    clauses.push(`branch IN (${f.branches.map(() => '?').join(',')})`);
    params.push(...f.branches);
  }
  if (f.sources?.length) {
    clauses.push(`source IN (${f.sources.map(() => '?').join(',')})`);
    params.push(...f.sources);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, params };
}
