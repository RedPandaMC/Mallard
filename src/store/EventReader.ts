/* c8 ignore next */
import { DuckDBConnection } from '@duckdb/node-api';
import { z } from 'zod';
import { CostCategory, Filter, SourceKind, Surface, UsageEvent } from '../domain/types';
import { UNATTRIBUTED_REPO } from '../domain/aggregate';
import { DAY_MS } from '../util/time';
import {
  AggregateResult,
  BucketBy,
  CrossTab,
  RecordFilter,
  TimeBucket,
} from './EventRepository';
import { readRows, readPrepared } from './dbUtils';
import {
  COUNT_ALL_SQL,
  CREDITS_BY_BRANCH_SQL,
  FIND_ALL_SQL,
  FIND_BY_ID_SQL,
  QUERY_FACTS_BASE_SQL,
  READ_SNAP_CATEGORIES,
  READ_SNAP_DAILY,
  READ_SNAP_DIM_MODELS,
  READ_SNAP_DIM_REPOS,
  READ_SNAP_DIM_SOURCES,
  READ_SNAP_DIM_SURFACES,
  READ_SNAP_HOURLY,
  READ_SNAP_MODELS,
  READ_SNAP_REPOS,
  READ_SNAP_SANKEY,
  READ_SNAP_TOTALS,
} from './schema';

// ── SnapshotCache ─────────────────────────────────────────────────────────────

export interface SnapshotCache {
  totals: {
    all:   { credits: number; cost: number; tokens: number; eventCount: number };
    mtd:   { credits: number; cost: number; tokens: number; eventCount: number };
    today: { credits: number; cost: number; tokens: number; eventCount: number };
  };
  /** day_start = epoch ms of local midnight, DST-correct. */
  daily:      Array<{ dayStart: number; credits: number; cost: number; tokens: number; eventCount: number }>;
  models:     Array<{ modelId: string; credits: number; cost: number; tokens: number }>;
  repos:      Array<{ repo: string; credits: number; cost: number; tokens: number }>;
  /** hour_local = 0-23 in session timezone (DST-correct). */
  hourly:     Array<{ hourLocal: number; credits: number }>;
  categories: Array<{ category: string; cost: number }>;
  sankey:     Array<{ model: string; surface: string; count: number; credits: number }>;
  dims:       { models: string[]; surfaces: string[]; sources: string[]; repos: string[] };
}

// ── FilteredSnapshotData ───────────────────────────────────────────────────────

/** Data returned by readFilteredSnapshot — all aggregations done server-side. */
export interface FilteredSnapshotData {
  totals: {
    all:   { credits: number; cost: number; tokens: number; eventCount: number };
    mtd:   { credits: number; cost: number; tokens: number; eventCount: number };
    today: { credits: number; cost: number; tokens: number; eventCount: number };
  };
  /** day_start = epoch ms of local midnight, DST-correct (matches snap_daily format). */
  daily:      Array<{ dayStart: number; credits: number; cost: number; tokens: number; eventCount: number }>;
  topModels:  Array<{ modelId: string; credits: number; cost: number; tokens: number }>;
  topRepos:   Array<{ repo: string; credits: number; cost: number; tokens: number }>;
  sankey:     Array<{ model: string; surface: string; count: number; credits: number }>;
  categories: Array<{ category: string; cost: number }>;
  /** hour_local = 0-23, DST-correct. */
  hourly:     Array<{ hourLocal: number; credits: number }>;
  /** Distinct values scoped to range filter only — keeps dropdowns stable. */
  dims:       { models: string[]; surfaces: string[]; sources: string[]; repos: string[] };
}

// ── FactRow ────────────────────────────────────────────────────────────────────

export interface FactRow {
  day: string;
  credits: number;
  cost: number;
  tokens: number;
  eventCount: number;
  costInput: number;
  costOutput: number;
  costCacheRead: number;
  costCacheWrite: number;
  costThinking: number;
  costTool: number;
}

// ── Interfaces ─────────────────────────────────────────────────────────────────

export interface IEventReader {
  find(filter?: RecordFilter): Promise<UsageEvent[]>;
  findById(id: string): Promise<UsageEvent | null>;
  count(filter?: RecordFilter): Promise<number>;
  exists(id: string): Promise<boolean>;
  dump(): Promise<UsageEvent[]>;
  aggregate(filter: RecordFilter, fields: string[]): Promise<AggregateResult>;
  bucket(filter: RecordFilter, by: BucketBy): Promise<TimeBucket[]>;
  pivot(filter: RecordFilter, on: string, value: string): Promise<CrossTab>;
  rank(filter: RecordFilter, by: string, limit?: number): Promise<TimeBucket[]>;
  queryFacts(filter?: RecordFilter): Promise<FactRow[]>;
  readSnapshotCache(): Promise<SnapshotCache>;
  readFilteredSnapshot(filter: RecordFilter): Promise<FilteredSnapshotData>;
  creditsByBranch(branch: string): Promise<number>;
  /** @deprecated Use find(). */
  query(filter?: Filter): Promise<UsageEvent[]>;
}

// ── Row parsing ────────────────────────────────────────────────────────────────

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

function rowToEvent(row: Record<string, unknown>): UsageEvent | null {
  const result = EventRow.safeParse(row);
  /* c8 ignore next 4 */
  if (!result.success) {
    console.warn('[mallard] EventReader: skipping malformed row', result.error.issues[0]?.message, row);
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

// ── Filter helpers ─────────────────────────────────────────────────────────────

function dateToId(ms: number): number {
  const d = new Date(ms);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

function buildFilterSQL(filter?: RecordFilter): { clause: string; params: unknown[] } {
  /* c8 ignore next */
  if (!filter) return { clause: '', params: [] };
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.range) {
    conditions.push('ts >= ? AND ts < ?');
    params.push(filter.range.start, filter.range.end);
  }
  if (filter.models?.length) {
    conditions.push(`modelId IN (${filter.models.map(() => '?').join(',')})`);
    params.push(...filter.models);
  }
  if (filter.surfaces?.length) {
    conditions.push(`surface IN (${filter.surfaces.map(() => '?').join(',')})`);
    params.push(...filter.surfaces);
  }
  if (filter.sources?.length) {
    conditions.push(`source IN (${filter.sources.map(() => '?').join(',')})`);
    params.push(...filter.sources);
  }
  if (filter.branches?.length) {
    conditions.push(`branch IN (${filter.branches.map(() => '?').join(',')})`);
    params.push(...filter.branches);
  }
  if (filter.repos?.length) {
    const named    = filter.repos.filter((r) => r !== UNATTRIBUTED_REPO);
    const hasUnattr = filter.repos.includes(UNATTRIBUTED_REPO);
    const repoParts: string[] = [];
    if (named.length) {
      repoParts.push(`repo IN (${named.map(() => '?').join(',')})`);
      params.push(...named);
    }
    if (hasUnattr) repoParts.push('repo IS NULL');
    if (repoParts.length) conditions.push(`(${repoParts.join(' OR ')})`);
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

function buildFactsFilterSQL(filter?: RecordFilter): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter?.range) {
    conditions.push('f.date_id >= ? AND f.date_id < ?');
    params.push(dateToId(filter.range.start), dateToId(filter.range.end));
  }
  if (filter?.models?.length) {
    conditions.push(`m.name IN (${filter.models.map(() => '?').join(',')})`);
    params.push(...filter.models);
  }
  if (filter?.surfaces?.length) {
    conditions.push(`sf.name IN (${filter.surfaces.map(() => '?').join(',')})`);
    params.push(...filter.surfaces);
  }
  if (filter?.sources?.length) {
    conditions.push(`sc.name IN (${filter.sources.map(() => '?').join(',')})`);
    params.push(...filter.sources);
  }
  if (filter?.repos?.length) {
    const named    = filter.repos.filter((r) => r !== UNATTRIBUTED_REPO);
    const hasUnattr = filter.repos.includes(UNATTRIBUTED_REPO);
    const sub: string[] = [];
    if (named.length) {
      sub.push(`r.name IN (${named.map(() => '?').join(',')})`);
      params.push(...named);
    }
    if (hasUnattr) sub.push(`r.name = 'unattributed'`);
    if (sub.length) conditions.push(`(${sub.join(' OR ')})`);
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}


// ── Implementation ─────────────────────────────────────────────────────────────

export class EventReader implements IEventReader {
  constructor(private readonly conn: DuckDBConnection) {}

  async find(filter?: RecordFilter): Promise<UsageEvent[]> {
    if (!filter || Object.keys(filter).length === 0) {
      const rows = await readRows(this.conn, FIND_ALL_SQL, rowToEvent);
      return rows.filter((e): e is UsageEvent => e !== null);
    }

    const { clause, params } = buildFilterSQL(filter);
    const limitPart  = filter.limit  ? ` LIMIT ${filter.limit}`   : '';
    const offsetPart = filter.offset ? ` OFFSET ${filter.offset}` : '';
    const sql = `SELECT * FROM events ${clause} ORDER BY ts${limitPart}${offsetPart}`;

    const rows = await readPrepared(this.conn, sql, params, rowToEvent);
    return rows.filter((e): e is UsageEvent => e !== null);
  }

  async findById(id: string): Promise<UsageEvent | null> {
    const rows = await readPrepared(this.conn, FIND_BY_ID_SQL, [id], rowToEvent);
    return rows[0] ?? null;
  }

  async count(filter?: RecordFilter): Promise<number> {
    if (!filter || Object.keys(filter).length === 0) {
      const rows = await readRows(this.conn, COUNT_ALL_SQL, (r) => Number(r['c']));
      /* c8 ignore next */
      return rows[0] ?? 0;
    }
    const { clause, params } = buildFilterSQL(filter);
    const rows = await readPrepared(
      this.conn,
      `SELECT COUNT(*) AS c FROM events ${clause}`,
      params,
      (r) => Number(r['c']),
    );
    /* c8 ignore next */
    return rows[0] ?? 0;
  }

  async exists(id: string): Promise<boolean> {
    return (await this.findById(id)) !== null;
  }

  async dump(): Promise<UsageEvent[]> {
    return this.find();
  }

  /** @deprecated Use find(). */
  async query(filter?: Filter): Promise<UsageEvent[]> {
    return this.find(filter);
  }

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

    const { clause, params } = buildFilterSQL(filter);
    const sql = `SELECT COUNT(*) AS total, ${selects.join(', ')} FROM events ${clause}`;

    const rows = await readPrepared(this.conn, sql, params, (r) => r);
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
    const { clause, params } = buildFilterSQL(filter);
    let keyExpr: string;
    switch (by) {
      case 'hour':    keyExpr = "strftime(to_timestamp(ts / 1000.0)::TIMESTAMPTZ, '%H')"; break;
      case 'weekday': keyExpr = 'CAST(dayofweek(to_timestamp(ts / 1000.0)::TIMESTAMPTZ) AS VARCHAR)'; break;
      case 'week':    keyExpr = "strftime(date_trunc('week', to_timestamp(ts / 1000.0)::TIMESTAMPTZ), '%Y-%m-%d')"; break;
      case 'month':   keyExpr = "strftime(date_trunc('month', to_timestamp(ts / 1000.0)::TIMESTAMPTZ), '%Y-%m')"; break;
      default:        keyExpr = "strftime(to_timestamp(ts / 1000.0)::TIMESTAMPTZ, '%Y-%m-%d')";
    }

    const sql = `
      SELECT
        ${keyExpr} AS bucket_key,
        COALESCE(SUM(credits), 0) AS credits,
        COALESCE(SUM(cost), 0) AS cost,
        COALESCE(SUM(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0)), 0) AS tokens,
        COUNT(*) AS event_count
      FROM events ${clause}
      GROUP BY bucket_key
      ORDER BY bucket_key`;

    const rows = await readPrepared(this.conn, sql, params, (r) => r);
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
    const { clause, params } = buildFilterSQL(filter);

    const colRows = await readPrepared(
      this.conn,
      `SELECT DISTINCT ${safeOn} AS col FROM events ${clause} ORDER BY col`,
      params,
      /* c8 ignore next */
      (r) => String(r['col'] ?? ''),
    );

    /* c8 ignore next */
    const columnKeys = colRows.filter(Boolean);
    if (columnKeys.length === 0) return { rows: [], columnKeys: [] };

    const pivotCols = columnKeys.map(
      (k) =>
        `COALESCE(SUM(CASE WHEN ${safeOn} = '${k.replace(/'/g, "''")}' THEN ${safeValue} ELSE 0 END), 0) AS "${k}"`,
    );

    const dataRows = await readPrepared(
      this.conn,
      `SELECT modelId, ${pivotCols.join(', ')} FROM events ${clause} GROUP BY modelId ORDER BY SUM(${safeValue}) DESC`,
      params,
      (r) => r,
    );

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
    const { clause, params } = buildFilterSQL(filter);

    const sql = `
      SELECT
        modelId AS rank_key,
        COALESCE(SUM(credits), 0) AS credits,
        COALESCE(SUM(cost), 0)    AS cost,
        COALESCE(SUM(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0)), 0) AS tokens
      FROM events ${clause}
      GROUP BY modelId
      ORDER BY SUM(${safeBy}) DESC
      LIMIT ${limit}`;

    const rows = await readPrepared(this.conn, sql, params, (r) => r);
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

  async queryFacts(filter?: RecordFilter): Promise<FactRow[]> {
    const { clause, params } = buildFactsFilterSQL(filter);
    const sql = `${QUERY_FACTS_BASE_SQL} ${clause} GROUP BY d.date ORDER BY d.date`;

    const rows = await readPrepared(this.conn, sql, params, (r) => r);
    /* c8 ignore next 14 */
    return rows.map((row) => ({
      day:            String(row['date']            ?? ''),
      credits:        Number(row['credits']         ?? 0),
      cost:           Number(row['cost']            ?? 0),
      tokens:         Number(row['tokens']          ?? 0),
      eventCount:     Number(row['event_count']     ?? 0),
      costInput:      Number(row['cost_input']      ?? 0),
      costOutput:     Number(row['cost_output']     ?? 0),
      costCacheRead:  Number(row['cost_cache_read'] ?? 0),
      costCacheWrite: Number(row['cost_cache_write']?? 0),
      costThinking:   Number(row['cost_thinking']   ?? 0),
      costTool:       Number(row['cost_tool']       ?? 0),
    }));
  }

  async readSnapshotCache(): Promise<SnapshotCache> {
    const [totalsRaw, daily, models, repos, hourly, categories, sankey,
           dimModels, dimSurfaces, dimSources, dimRepos] = await Promise.all([
      readRows(this.conn, READ_SNAP_TOTALS, (r) => r),
      /* c8 ignore start */
      readRows(this.conn, READ_SNAP_DAILY,  (r) => ({
        dayStart:   Number(r['day_start']   ?? 0),
        credits:    Number(r['credits']     ?? 0),
        cost:       Number(r['cost']        ?? 0),
        tokens:     Number(r['tokens']      ?? 0),
        eventCount: Number(r['event_count'] ?? 0),
      })),
      readRows(this.conn, READ_SNAP_MODELS, (r) => ({
        modelId: String(r['modelId'] ?? ''),
        credits: Number(r['credits'] ?? 0),
        cost:    Number(r['cost']    ?? 0),
        tokens:  Number(r['tokens']  ?? 0),
      })),
      readRows(this.conn, READ_SNAP_REPOS, (r) => ({
        repo:    String(r['repo']    ?? ''),
        credits: Number(r['credits'] ?? 0),
        cost:    Number(r['cost']    ?? 0),
        tokens:  Number(r['tokens']  ?? 0),
      })),
      readRows(this.conn, READ_SNAP_HOURLY, (r) => ({
        hourLocal: Number(r['hour_local'] ?? 0),
        credits:   Number(r['credits']   ?? 0),
      })),
      readRows(this.conn, READ_SNAP_CATEGORIES, (r) => ({
        category: String(r['category'] ?? ''),
        cost:     Number(r['cost']     ?? 0),
      })),
      readRows(this.conn, READ_SNAP_SANKEY, (r) => ({
        model:   String(r['model']   ?? ''),
        surface: String(r['surface'] ?? ''),
        count:   Number(r['count']   ?? 0),
        credits: Number(r['credits'] ?? 0),
      })),
      readRows(this.conn, READ_SNAP_DIM_MODELS,   (r) => String(r['name'] ?? '')),
      readRows(this.conn, READ_SNAP_DIM_SURFACES, (r) => String(r['name'] ?? '')),
      readRows(this.conn, READ_SNAP_DIM_SOURCES,  (r) => String(r['name'] ?? '')),
      readRows(this.conn, READ_SNAP_DIM_REPOS,    (r) => String(r['name'] ?? '')),
      /* c8 ignore stop */
    ]);

    const zero = { credits: 0, cost: 0, tokens: 0, eventCount: 0 };
    const totals = { all: { ...zero }, mtd: { ...zero }, today: { ...zero } };
    for (const row of totalsRaw) {
      /* c8 ignore start */
      const period = String(row['period'] ?? '');
      if (period === 'all' || period === 'mtd' || period === 'today') {
        totals[period] = {
          credits:    Number(row['credits']     ?? 0),
          cost:       Number(row['cost']        ?? 0),
          tokens:     Number(row['tokens']      ?? 0),
          eventCount: Number(row['event_count'] ?? 0),
        };
      }
      /* c8 ignore stop */
    }

    return {
      totals,
      daily,
      models,
      repos,
      hourly,
      categories,
      sankey,
      dims: {
        models:   dimModels,
        surfaces: dimSurfaces,
        sources:  dimSources,
        repos:    dimRepos,
      },
    };
  }

  async readFilteredSnapshot(filter: RecordFilter): Promise<FilteredSnapshotData> {
    const { clause, params }                           = buildFilterSQL(filter);
    const rangeOnly: RecordFilter                      = filter.range ? { range: filter.range } : {};
    const { clause: rangeClause, params: rangeParams } = buildFilterSQL(rangeOnly);

    // Single query: MATERIALIZED CTEs scan `events` exactly twice (full filter +
    // range-only), then all aggregations run over the in-memory CTE buffers.
    // Arrays are serialised to JSON inside DuckDB so JS receives plain strings —
    // avoiding @duckdb/node-api's LIST<STRUCT> → JS conversion quirks.
    const tok      = `COALESCE(CAST(SUM(COALESCE(promptTokens,0)+COALESCE(completionTokens,0)) AS BIGINT),0)`;
    const mtdCond  = `date_trunc('month', to_timestamp(ts/1000.0)::TIMESTAMPTZ) = date_trunc('month', now()::TIMESTAMPTZ)`;
    const todaCond = `date_trunc('day',   to_timestamp(ts/1000.0)::TIMESTAMPTZ) = date_trunc('day',   now()::TIMESTAMPTZ)`;

    // Scalar subquery over f (optional extra WHERE condition)
    const agg = (col: string, cond = '') =>
      `(SELECT ${col} FROM f${cond ? ` WHERE ${cond}` : ''})`;

    // Aggregate inner subquery rows into a JSON array string via list() + to_json()
    const listJson = (fields: string, from: string, orderBy = '') =>
      `(SELECT COALESCE(to_json(list({${fields}}${orderBy ? ` ORDER BY ${orderBy}` : ''}))::VARCHAR, '[]') FROM (${from}))`;

    const sql = `
WITH
  f  AS MATERIALIZED (SELECT * FROM events ${clause}),
  ro AS MATERIALIZED (SELECT * FROM events ${rangeClause})
SELECT
  ${agg(`COALESCE(SUM(credits),0)`)}                     AS all_credits,
  ${agg(`COALESCE(SUM(cost),0)`)}                        AS all_cost,
  ${agg(tok)}                                            AS all_tokens,
  ${agg(`COUNT(*)`)}                                     AS all_ec,
  ${agg(`COALESCE(SUM(credits),0)`, mtdCond)}            AS mtd_credits,
  ${agg(`COALESCE(SUM(cost),0)`,    mtdCond)}            AS mtd_cost,
  ${agg(tok,                        mtdCond)}            AS mtd_tokens,
  ${agg(`COUNT(*)`,                 mtdCond)}            AS mtd_ec,
  ${agg(`COALESCE(SUM(credits),0)`, todaCond)}           AS today_credits,
  ${agg(`COALESCE(SUM(cost),0)`,    todaCond)}           AS today_cost,
  ${agg(tok,                        todaCond)}           AS today_tokens,
  ${agg(`COUNT(*)`,                 todaCond)}           AS today_ec,
  ${listJson(
    `'day_start': day_start, 'credits': credits, 'cost': cost, 'tokens': tokens, 'event_count': event_count`,
    `SELECT CAST(extract(epoch from date_trunc('day', to_timestamp(ts/1000.0)::TIMESTAMPTZ))*1000 AS BIGINT) AS day_start,
            COALESCE(SUM(credits),0) AS credits, COALESCE(SUM(cost),0) AS cost,
            ${tok} AS tokens, COUNT(*) AS event_count FROM f GROUP BY 1`,
    'day_start',
  )} AS daily,
  ${listJson(
    `'modelId': modelId, 'credits': credits, 'cost': cost, 'tokens': tokens`,
    `SELECT modelId, COALESCE(SUM(credits),0) AS credits, COALESCE(SUM(cost),0) AS cost,
            ${tok} AS tokens FROM f GROUP BY modelId`,
    'credits DESC',
  )} AS top_models,
  ${listJson(
    `'repo': repo, 'credits': credits, 'cost': cost, 'tokens': tokens`,
    `SELECT COALESCE(repo,'unattributed') AS repo, COALESCE(SUM(credits),0) AS credits,
            COALESCE(SUM(cost),0) AS cost, ${tok} AS tokens
     FROM f GROUP BY COALESCE(repo,'unattributed')`,
    'credits DESC',
  )} AS top_repos,
  ${listJson(
    `'model': model, 'surface': surface, 'count': cnt, 'credits': credits`,
    `SELECT modelId AS model, surface, COUNT(*) AS cnt, COALESCE(SUM(credits),0) AS credits
     FROM f WHERE credits > 0 GROUP BY modelId, surface`,
  )} AS sankey,
  ${agg(`COALESCE(SUM(COALESCE(TRY_CAST(json_extract_string(costByCategory,'$.input')          AS DOUBLE),0)),0)`)} AS cat_input,
  ${agg(`COALESCE(SUM(COALESCE(TRY_CAST(json_extract_string(costByCategory,'$.output')         AS DOUBLE),0)),0)`)} AS cat_output,
  ${agg(`COALESCE(SUM(COALESCE(TRY_CAST(json_extract_string(costByCategory,'$.tool')           AS DOUBLE),0)),0)`)} AS cat_tool,
  ${agg(`COALESCE(SUM(COALESCE(TRY_CAST(json_extract_string(costByCategory,'$.thinking')       AS DOUBLE),0)),0)`)} AS cat_thinking,
  ${agg(`COALESCE(SUM(COALESCE(TRY_CAST(json_extract_string(costByCategory,'$.cache_creation') AS DOUBLE),0)),0)`)} AS cat_cache_creation,
  ${agg(`COALESCE(SUM(COALESCE(TRY_CAST(json_extract_string(costByCategory,'$.cache_read')     AS DOUBLE),0)),0)`)} AS cat_cache_read,
  ${agg(`COALESCE(SUM(COALESCE(TRY_CAST(json_extract_string(costByCategory,'$.unknown')        AS DOUBLE),0)),0)`)} AS cat_unknown,
  ${listJson(
    `'hour_local': hour_local, 'credits': credits`,
    `SELECT CAST(strftime(to_timestamp(ts/1000.0)::TIMESTAMPTZ,'%H') AS INTEGER) AS hour_local,
            COALESCE(SUM(credits),0) AS credits FROM f GROUP BY 1`,
    'hour_local',
  )} AS hourly,
  (SELECT COALESCE(to_json(list(name ORDER BY name))::VARCHAR,'[]') FROM (SELECT DISTINCT modelId AS name FROM ro WHERE modelId IS NOT NULL)) AS dim_models,
  (SELECT COALESCE(to_json(list(name ORDER BY name))::VARCHAR,'[]') FROM (SELECT DISTINCT surface  AS name FROM ro WHERE surface  IS NOT NULL)) AS dim_surfaces,
  (SELECT COALESCE(to_json(list(name ORDER BY name))::VARCHAR,'[]') FROM (SELECT DISTINCT source   AS name FROM ro WHERE source   IS NOT NULL)) AS dim_sources,
  (SELECT COALESCE(to_json(list(name ORDER BY name))::VARCHAR,'[]') FROM (SELECT DISTINCT COALESCE(repo,'unattributed') AS name FROM ro))       AS dim_repos
`;

    /* c8 ignore start */
    const rows = await readPrepared(this.conn, sql, [...params, ...rangeParams], (r) => r);
    const row  = rows[0] ?? {};

    const parseArr = <T>(key: string): T[] => {
      const v = row[key];
      if (v == null) return [];
      return JSON.parse(String(v)) as T[];
    };

    const mkTotals = (pfx: string): FilteredSnapshotData['totals']['all'] => ({
      credits:    Number(row[`${pfx}_credits`] ?? 0),
      cost:       Number(row[`${pfx}_cost`]    ?? 0),
      tokens:     Number(row[`${pfx}_tokens`]  ?? 0),
      eventCount: Number(row[`${pfx}_ec`]      ?? 0),
    });

    const catPairs: [string, string][] = [
      ['cat_input', 'input'], ['cat_output', 'output'], ['cat_tool', 'tool'],
      ['cat_thinking', 'thinking'], ['cat_cache_creation', 'cache_creation'],
      ['cat_cache_read', 'cache_read'], ['cat_unknown', 'unknown'],
    ];
    const categories: FilteredSnapshotData['categories'] = [];
    for (const [col, cat] of catPairs) {
      const cost = Number(row[col] ?? 0);
      if (cost > 0) categories.push({ category: cat, cost });
    }

    const dailyArr  = parseArr<Record<string, unknown>>('daily');
    const modelArr  = parseArr<Record<string, unknown>>('top_models');
    const repoArr   = parseArr<Record<string, unknown>>('top_repos');
    const sankeyArr = parseArr<Record<string, unknown>>('sankey');
    const hourArr   = parseArr<Record<string, unknown>>('hourly');

    return {
      totals: { all: mkTotals('all'), mtd: mkTotals('mtd'), today: mkTotals('today') },
      daily: dailyArr.map((r) => ({
        dayStart:   Number(r['day_start']   ?? 0),
        credits:    Number(r['credits']     ?? 0),
        cost:       Number(r['cost']        ?? 0),
        tokens:     Number(r['tokens']      ?? 0),
        eventCount: Number(r['event_count'] ?? 0),
      })),
      topModels: modelArr.map((r) => ({
        modelId: String(r['modelId'] ?? ''),
        credits: Number(r['credits'] ?? 0),
        cost:    Number(r['cost']    ?? 0),
        tokens:  Number(r['tokens']  ?? 0),
      })),
      topRepos: repoArr.map((r) => ({
        repo:    String(r['repo']    ?? ''),
        credits: Number(r['credits'] ?? 0),
        cost:    Number(r['cost']    ?? 0),
        tokens:  Number(r['tokens']  ?? 0),
      })),
      sankey: sankeyArr.map((r) => ({
        model:   String(r['model']   ?? ''),
        surface: String(r['surface'] ?? ''),
        count:   Number(r['count']   ?? 0),
        credits: Number(r['credits'] ?? 0),
      })),
      categories,
      hourly: hourArr.map((r) => ({
        hourLocal: Number(r['hour_local'] ?? 0),
        credits:   Number(r['credits']   ?? 0),
      })),
      dims: {
        models:   parseArr<string>('dim_models'),
        surfaces: parseArr<string>('dim_surfaces'),
        sources:  parseArr<string>('dim_sources'),
        repos:    parseArr<string>('dim_repos'),
      },
    };
    /* c8 ignore stop */
  }

  async creditsByBranch(branch: string): Promise<number> {
    const rows = await readPrepared(
      this.conn,
      CREDITS_BY_BRANCH_SQL,
      [branch],
      /* c8 ignore next */
      (r) => Number(r['c'] ?? 0),
    );
    /* c8 ignore next */
    return rows[0] ?? 0;
  }
}

/* c8 ignore next */
function emptyAggregate(): AggregateResult {
  return { count: 0, sum: {}, mean: {}, stddev: {}, p50: {}, p95: {}, min: {}, max: {} };
}

export type { RecordFilter, AggregateResult, BucketBy, CrossTab, TimeBucket };
export { DAY_MS };
