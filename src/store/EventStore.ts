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
import { DuckDBConnection, DuckDBInstance, DuckDBPreparedStatement } from '@duckdb/node-api';
import { CostCategory, Filter, SourceKind, Surface, UsageEvent } from '../domain/types';
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
/* c8 ignore stop */

type Categories = Partial<Record<CostCategory, number>>;

const EventRow = z.object({
  id: z.string(),
  ts: z.union([z.number(), z.bigint()]).transform(Number),
  modelId: z.string(),
  surface: z.enum(['chat', 'inline', 'agent', 'edit', 'unknown']).catch('unknown'),
  source: z.enum(['lm', 'local', 'github', 'claude-code']).catch('local'),
  credits: z.number(),
  cost: z.number(),
  estimated: z.boolean().catch(true),
  promptTokens: z.number().nullish(),
  completionTokens: z.number().nullish(),
  repo: z.string().nullish(),
  branch: z.string().nullish(),
  costByCategory: z.string().nullish(),
});

/** Sum two optional category maps; returns undefined when both are absent. */
function addCategories(a?: Categories, b?: Categories): Categories | undefined {
  if (!a && !b) return undefined;
  /* c8 ignore next */
  const out: Categories = { ...(a ?? {}) };
  /* c8 ignore next */
  for (const [k, v] of Object.entries(b ?? {})) {
    /* c8 ignore next */
    out[k as CostCategory] = (out[k as CostCategory] ?? 0) + (v ?? 0);
  }
  return out;
}

/** Collapse old per-request events into one row per day/model/repo/surface. */
export function rollupEvents(old: UsageEvent[]): UsageEvent[] {
  const map = new Map<string, UsageEvent>();
  for (const e of old) {
    const day = startOf(e.ts, 'day');
    /* c8 ignore next */
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
    costByCategory VARCHAR,
    branch VARCHAR
  );
  CREATE INDEX IF NOT EXISTS idx_ts ON events(ts);
  CREATE INDEX IF NOT EXISTS idx_model ON events(modelId);
  CREATE INDEX IF NOT EXISTS idx_ts_model_surface_source
    ON events(ts, modelId, surface, source);
  CREATE TABLE IF NOT EXISTS meta (key VARCHAR PRIMARY KEY, value VARCHAR);
  ALTER TABLE events ADD COLUMN IF NOT EXISTS branch VARCHAR;

  -- Shift-left view hierarchy: computation defined once in schema, queried with GROUP BY/WHERE.
  -- CREATE OR REPLACE VIEW keeps definitions current across upgrades without version bumps.

  -- Base normalization layer: one row per event, NULLs resolved, is_rolled flag added.
  -- repo stays nullable (compact preserves NULL for unattributed rows in events.repo);
  -- repo_label is the non-null label used in aggregation GROUP BYs.
  CREATE OR REPLACE VIEW v_events AS
    SELECT
      id, ts, modelId, surface, source,
      repo,
      COALESCE(repo, 'unattributed')   AS repo_label,
      credits, cost, estimated,
      COALESCE(promptTokens, 0)        AS prompt_tokens,
      COALESCE(completionTokens, 0)    AS completion_tokens,
      id LIKE 'roll:%'                 AS is_rolled
    FROM events;

  -- UTC day × 5 dims over ALL events (raw + rolled). Foundation for week/month views.
  -- Every chart aggregation is a GROUP BY rollup on this view — no chart-specific views needed.
  CREATE OR REPLACE VIEW v_usage_daily AS
    SELECT
      strftime(to_timestamp(e.ts / 1000), '%Y-%m-%d') AS day,
      e.modelId, e.surface, e.source,
      e.repo_label                                     AS repo,
      SUM(e.credits)                                   AS credits,
      SUM(e.cost)                                      AS cost,
      SUM(e.prompt_tokens)                             AS prompt_tokens,
      SUM(e.completion_tokens)                         AS completion_tokens,
      COUNT(*)                                         AS event_count
    FROM v_events e
    GROUP BY strftime(to_timestamp(e.ts / 1000), '%Y-%m-%d'),
             e.modelId, e.surface, e.source, e.repo_label;

  -- ISO week × 5 dims, folded from v_usage_daily.
  CREATE OR REPLACE VIEW v_usage_weekly AS
    SELECT
      strftime(date_trunc('week', day::DATE), '%Y-%m-%d') AS week_start,
      modelId, surface, source, repo,
      SUM(credits)           AS credits,
      SUM(cost)              AS cost,
      SUM(prompt_tokens)     AS prompt_tokens,
      SUM(completion_tokens) AS completion_tokens,
      SUM(event_count)       AS event_count
    FROM v_usage_daily
    GROUP BY date_trunc('week', day::DATE), modelId, surface, source, repo;

  -- YYYY-MM × 5 dims, folded from v_usage_daily.
  CREATE OR REPLACE VIEW v_usage_monthly AS
    SELECT
      LEFT(day, 7)           AS month,
      modelId, surface, source, repo,
      SUM(credits)           AS credits,
      SUM(cost)              AS cost,
      SUM(prompt_tokens)     AS prompt_tokens,
      SUM(completion_tokens) AS completion_tokens,
      SUM(event_count)       AS event_count
    FROM v_usage_daily
    GROUP BY LEFT(day, 7), modelId, surface, source, repo;

  -- Hour-of-day UTC × 5 dims. Reads v_events directly: daily grain loses sub-day ts.
  CREATE OR REPLACE VIEW v_usage_hourly AS
    SELECT
      CAST(strftime(to_timestamp(e.ts / 1000), '%H') AS INTEGER) AS hour_utc,
      e.modelId, e.surface, e.source, e.repo_label               AS repo,
      SUM(e.credits)   AS credits,
      SUM(e.cost)      AS cost,
      COUNT(*)         AS event_count
    FROM v_events e
    GROUP BY CAST(strftime(to_timestamp(e.ts / 1000), '%H') AS INTEGER),
             e.modelId, e.surface, e.source, e.repo_label;

  -- Weekday (0=Sun…6=Sat) × 5 dims. Reads v_events directly.
  CREATE OR REPLACE VIEW v_usage_by_weekday AS
    SELECT
      CAST(dayofweek(to_timestamp(e.ts / 1000)) AS INTEGER) AS weekday,
      e.modelId, e.surface, e.source, e.repo_label          AS repo,
      SUM(e.credits)   AS credits,
      SUM(e.cost)      AS cost,
      COUNT(*)         AS event_count
    FROM v_events e
    GROUP BY CAST(dayofweek(to_timestamp(e.ts / 1000)) AS INTEGER),
             e.modelId, e.surface, e.source, e.repo_label;

  -- Raw-only daily rollup for compact(). Composed from v_events WHERE NOT is_rolled.
  -- repo preserved nullable so unattributed rolled rows keep NULL in events.repo,
  -- which matches the 'repo IS NULL' predicate in buildWhere() for UNATTRIBUTED_REPO.
  -- Table-alias e.ts in GROUP BY avoids DuckDB GROUP BY / SELECT alias collision.
  CREATE OR REPLACE VIEW v_daily_rollup AS
    SELECT
      'roll:' || strftime(to_timestamp(MIN(e.ts) / 1000), '%Y-%m-%d')
        || ':' || e.modelId
        || ':' || COALESCE(e.repo, 'unattributed')
        || ':' || e.surface
        || ':' || e.source                             AS id,
      MIN(e.ts) / 86400000 * 86400000                  AS ts,
      e.modelId, e.surface, e.source,
      e.repo,
      SUM(e.credits)                                   AS credits,
      SUM(e.cost)                                      AS cost,
      CAST(SUM(e.prompt_tokens) AS INTEGER)            AS promptTokens,
      CAST(SUM(e.completion_tokens) AS INTEGER)        AS completionTokens,
      true                                             AS estimated,
      NULL::VARCHAR                                    AS costByCategory,
      NULL::VARCHAR                                    AS branch
    FROM v_events e
    WHERE NOT e.is_rolled
    GROUP BY strftime(to_timestamp(e.ts / 1000), '%Y-%m-%d'),
             e.modelId, e.surface, e.source, e.repo;
`;

const INSERT_SQL = `INSERT OR IGNORE INTO events
  (id, ts, modelId, surface, source, credits, cost, promptTokens, completionTokens, estimated, repo, costByCategory, branch)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`;

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
    /* c8 ignore next 3 */
    } catch {
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

/** Build a WHERE clause from a RecordFilter; returns { sql, params }. */
function buildWhere(filter: RecordFilter): { sql: string; params: unknown[] } {
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
    const named = filter.repos.filter((r) => r !== UNATTRIBUTED_REPO);
    const parts: string[] = [];
    if (named.length) {
      parts.push(`repo IN (${named.map(() => '?').join(',')})`);
      params.push(...named);
    }
    if (filter.repos.includes(UNATTRIBUTED_REPO)) parts.push('repo IS NULL');
    if (parts.length) clauses.push(`(${parts.join(' OR ')})`);
  }
  if (filter.branches?.length) {
    clauses.push(`branch IN (${filter.branches.map(() => '?').join(',')})`);
    params.push(...filter.branches);
  }
  if (filter.sources?.length) {
    clauses.push(`source IN (${filter.sources.map(() => '?').join(',')})`);
    params.push(...filter.sources);
  }

  const sql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return { sql, params };
}

export class EventStore implements EventRepository {
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

  // ── EventRepository: writes ──────────────────────────────────────────────────

  async insert(records: UsageEvent[]): Promise<number> {
    /* c8 ignore next */
    if (records.length === 0) return 0;
    const inserted = await this.insertAll(records);
    const total = await this.count();
    /* c8 ignore next */
    if (total > MAX_RAW_EVENTS) await this.compact();
    return inserted;
  }

  /** @deprecated Use `insert()`. Kept for API compatibility. */
  async append(incoming: UsageEvent[]): Promise<number> {
    return this.insert(incoming);
  }

  // ── EventRepository: point reads ─────────────────────────────────────────────

  async findById(id: string): Promise<UsageEvent | null> {
    const rows = await this.select('SELECT * FROM events WHERE id = ?', [id]);
    return rows[0] ?? null;
  }

  async find(filter?: RecordFilter): Promise<UsageEvent[]> {
    if (!filter) return this.select('SELECT * FROM events ORDER BY ts');
    const { sql, params } = buildWhere(filter);
    const limitClause = filter.limit ? ` LIMIT ${filter.limit}` : '';
    const offsetClause = filter.offset ? ` OFFSET ${filter.offset}` : '';
    return this.select(
      `SELECT * FROM events ${sql} ORDER BY ts${limitClause}${offsetClause}`,
      params,
    );
  }

  /** @deprecated Use `find()`. */
  async query(filter?: Filter): Promise<UsageEvent[]> {
    return this.find(filter);
  }

  async count(filter?: RecordFilter): Promise<number> {
    if (!filter) {
      const rows = (await this.conn.runAndReadAll('SELECT count(*) AS c FROM events')).getRowObjects();
      /* c8 ignore next */
      return Number(rows[0]?.c ?? 0);
    }
    const { sql, params } = buildWhere(filter);
    const rows = (await this.runSql(`SELECT count(*) AS c FROM events ${sql}`, params)).getRowObjects();
    /* c8 ignore next */
    return Number(rows[0]?.c ?? 0);
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

    const { sql: where, params } = buildWhere(filter);
    const sql = `SELECT COUNT(*) AS total, ${selects.join(', ')} FROM events ${where}`;
    const rows = (await this.runSql(sql, params)).getRowObjects();
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
    const { sql: where, params } = buildWhere(filter);
    let keyExpr: string;
    switch (by) {
      case 'hour':
        keyExpr = "strftime(to_timestamp(ts / 1000), '%H')";
        break;
      case 'weekday':
        // DuckDB: dayofweek returns 0=Sunday … 6=Saturday
        keyExpr = 'CAST(dayofweek(to_timestamp(ts / 1000)) AS VARCHAR)';
        break;
      case 'week':
        keyExpr = "strftime(date_trunc('week', to_timestamp(ts / 1000)), '%Y-%m-%d')";
        break;
      case 'month':
        keyExpr = "strftime(date_trunc('month', to_timestamp(ts / 1000)), '%Y-%m')";
        break;
      default: // 'day'
        keyExpr = "strftime(to_timestamp(ts / 1000), '%Y-%m-%d')";
    }
    const sql = `
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
    const rows = (await this.runSql(sql, params)).getRowObjects();
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
    // DuckDB PIVOT syntax: pivot the `on` column, summing `value`.
    // We do it manually for safety (PIVOT syntax differs across DuckDB versions).
    /* c8 ignore next 2 */
    const safeOn    = /^[a-zA-Z_]+$/.test(on)    ? on    : 'surface';
    const safeValue = /^[a-zA-Z_]+$/.test(value) ? value : 'credits';

    const { sql: where, params } = buildWhere(filter);

    // Step 1: get distinct column values
    const colSql = `SELECT DISTINCT ${safeOn} AS col FROM events ${where} ORDER BY col`;
    const colRows = (await this.runSql(colSql, params)).getRowObjects();
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
    const dataRows = (await this.runSql(pivotSql, params)).getRowObjects();
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
    const { sql: where, params } = buildWhere(filter);
    const sql = `
      SELECT
        modelId AS rank_key,
        COALESCE(SUM(credits), 0) AS credits,
        COALESCE(SUM(cost), 0)    AS cost,
        COALESCE(SUM(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0)), 0) AS tokens
      FROM events ${where}
      GROUP BY modelId
      ORDER BY SUM(${safeBy}) DESC
      LIMIT ${limit}
    `;
    const rows = (await this.runSql(sql, params)).getRowObjects();
    /* c8 ignore start */
    return rows.map((r) => ({
      key: String(r['rank_key'] ?? ''),
      values: {
        credits: Number(r['credits'] ?? 0),
        cost:    Number(r['cost']    ?? 0),
        tokens:  Number(r['tokens']  ?? 0),
      },
    }));
    /* c8 ignore stop */
  }

  // ── EventRepository: meta ────────────────────────────────────────────────────

  async getMeta(key: string): Promise<string | null> {
    const prep = await this.conn.prepare('SELECT value FROM meta WHERE key = ?');
    prep.bindVarchar(1, key);
    const rows = (await prep.runAndReadAll()).getRowObjects();
    const v = rows[0]?.value;
    return typeof v === 'string' ? v : null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    const prep = await this.conn.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
    prep.bindVarchar(1, key);
    prep.bindVarchar(2, value);
    await prep.run();
  }

  // ── EventRepository: maintenance ─────────────────────────────────────────────

  async remove(filter: RecordFilter): Promise<number> {
    const { sql: where, params } = buildWhere(filter);
    if (!where) return 0; // safety: refuse to delete everything via remove()
    const before = await this.count();
    const sql = `DELETE FROM events ${where}`;
    if (params.length === 0) {
      await this.conn.run(sql);
    } else {
      const prep = await this.conn.prepare(sql);
      params.forEach((p, i) => bindParam(prep, i + 1, p));
      await prep.run();
    }
    const after = await this.count();
    return before - after;
  }

  async compact(now = Date.now()): Promise<void> {
    const cutoff = startOf(now - RAW_WINDOW_DAYS * DAY_MS, 'day');
    const cutoffBig = BigInt(cutoff);

    const checkPrep = await this.conn.prepare(
      "SELECT COUNT(*) AS c FROM events WHERE ts < ? AND id NOT LIKE 'roll:%'",
    );
    checkPrep.bindBigInt(1, cutoffBig);
    const checkRows = (await checkPrep.runAndReadAll()).getRowObjects();
    if (Number(checkRows[0]?.c ?? 0) === 0) return;

    // v_daily_rollup (defined in CREATE_SQL) holds the GROUP BY logic.
    // DuckDB pushes the ts < ? predicate through the view into the table scan.
    const rollupPrep = await this.conn.prepare(
      `INSERT OR IGNORE INTO events
         (id, ts, modelId, surface, source, credits, cost,
          promptTokens, completionTokens, estimated, repo, costByCategory, branch)
       SELECT id, ts, modelId, surface, source, credits, cost,
              promptTokens, completionTokens, estimated, repo, costByCategory, branch
       FROM v_daily_rollup
       WHERE ts < ?`,
    );
    rollupPrep.bindBigInt(1, cutoffBig);
    await rollupPrep.run();

    const delPrep = await this.conn.prepare(
      "DELETE FROM events WHERE ts < ? AND id NOT LIKE 'roll:%'",
    );
    delPrep.bindBigInt(1, cutoffBig);
    await delPrep.run();
  }

  /** @deprecated Use `compact()`. */
  async rollup(now = Date.now()): Promise<void> {
    return this.compact(now);
  }

  async dump(): Promise<UsageEvent[]> {
    return this.find();
  }

  async clear(): Promise<void> {
    await this.conn.run('DELETE FROM events');
    await this.conn.run('DELETE FROM meta');
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

  /** Bulk insert with dedup (INSERT OR IGNORE). Returns count of rows actually written. */
  private async insertAll(events: UsageEvent[]): Promise<number> {
    /* c8 ignore next */
    if (events.length === 0) return 0;
    await this.conn.run('BEGIN');
    let inserted = 0;
    try {
      const stmt = await this.conn.prepare(INSERT_SQL);
      for (const e of events) {
        bindEvent(stmt, e);
        inserted += (await stmt.run()).rowsChanged;
      }
      await this.conn.run('COMMIT');
    /* c8 ignore next 4 */
    } catch (err) {
      await this.conn.run('ROLLBACK');
      throw err;
    }
    return inserted;
  }

  private async select(sql: string, params: unknown[] = []): Promise<UsageEvent[]> {
    const toEvents = (rows: Record<string, unknown>[]): UsageEvent[] =>
      rows.map((r) => rowToEvent(r as Row)).filter((e): e is UsageEvent => e !== null);
    if (params.length === 0) {
      return toEvents((await this.conn.runAndReadAll(sql)).getRowObjects());
    }
    const prep = await this.conn.prepare(sql);
    params.forEach((p, i) => bindParam(prep, i + 1, p));
    return toEvents((await prep.runAndReadAll()).getRowObjects());
  }

  private async runSql(sql: string, params: unknown[]) {
    if (params.length === 0) return this.conn.runAndReadAll(sql);
    const prep = await this.conn.prepare(sql);
    params.forEach((p, i) => bindParam(prep, i + 1, p));
    return prep.runAndReadAll();
  }
}

function emptyAggregate(): AggregateResult {
  return { count: 0, sum: {}, mean: {}, stddev: {}, p50: {}, p95: {}, min: {}, max: {} };
}

/** Bind one positional parameter, choosing the DuckDB type from the JS value. */
function bindParam(stmt: DuckDBPreparedStatement, i: number, v: unknown): void {
  /* c8 ignore next */
  if (v === null || v === undefined) stmt.bindNull(i);
  else if (typeof v === 'number') stmt.bindBigInt(i, BigInt(Math.trunc(v)));
  else stmt.bindVarchar(i, String(v));
}

/* c8 ignore next */
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
  if (e.branch != null) stmt.bindVarchar(13, e.branch);
  else stmt.bindNull(13);
}
