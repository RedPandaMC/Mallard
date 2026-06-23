/* c8 ignore start */
import { Kysely, RawBuilder, sql } from 'kysely';
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
import type { Database } from './db-types';
/* c8 ignore stop */

// ── FactRow ────────────────────────────────────────────────────────────────────

/** One aggregated row returned by {@link EventReader.queryFacts}. */
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

/** Convert epoch-ms to YYYYMMDD integer (UTC) for dim_date.id lookups. */
function dateToId(ms: number): number {
  const d = new Date(ms);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

function buildWhereParts(filter: RecordFilter): RawBuilder<unknown>[] {
  const parts: RawBuilder<unknown>[] = [];

  if (filter.range) {
    parts.push(
      sql`ts >= ${BigInt(filter.range.start)} AND ts < ${BigInt(filter.range.end)}`,
    );
  }
  if (filter.models?.length) {
    parts.push(sql`modelId IN (${sql.join(filter.models)})`);
  }
  if (filter.surfaces?.length) {
    parts.push(sql`surface IN (${sql.join(filter.surfaces)})`);
  }
  if (filter.repos?.length) {
    const named = filter.repos.filter((r) => r !== UNATTRIBUTED_REPO);
    const hasUnattr = filter.repos.includes(UNATTRIBUTED_REPO);
    const subParts: RawBuilder<unknown>[] = [];
    if (named.length) subParts.push(sql`repo IN (${sql.join(named)})`);
    if (hasUnattr) subParts.push(sql`repo IS NULL`);
    if (subParts.length) parts.push(sql`(${sql.join(subParts, sql` OR `)})`);
  }
  if (filter.branches?.length) {
    parts.push(sql`branch IN (${sql.join(filter.branches)})`);
  }
  if (filter.sources?.length) {
    parts.push(sql`source IN (${sql.join(filter.sources)})`);
  }

  return parts;
}

function whereClause(filter: RecordFilter): RawBuilder<unknown> {
  const parts = buildWhereParts(filter);
  return parts.length > 0 ? sql`WHERE ${sql.join(parts, sql` AND `)}` : sql``;
}

/** WHERE parts for fact/dim JOIN queries (uses dim table aliases, not raw events columns). */
function buildFactsWhereParts(filter?: RecordFilter): RawBuilder<unknown>[] {
  const parts: RawBuilder<unknown>[] = [];
  if (filter?.range) {
    parts.push(sql`f.date_id >= ${dateToId(filter.range.start)} AND f.date_id < ${dateToId(filter.range.end)}`);
  }
  if (filter?.models?.length)   parts.push(sql`m.name IN (${sql.join(filter.models)})`);
  if (filter?.surfaces?.length) parts.push(sql`sf.name IN (${sql.join(filter.surfaces)})`);
  if (filter?.sources?.length)  parts.push(sql`sc.name IN (${sql.join(filter.sources)})`);
  if (filter?.repos?.length) {
    const named = filter.repos.filter((r) => r !== UNATTRIBUTED_REPO);
    const hasUnattr = filter.repos.includes(UNATTRIBUTED_REPO);
    const sub: RawBuilder<unknown>[] = [];
    if (named.length) sub.push(sql`r.name IN (${sql.join(named)})`);
    if (hasUnattr)    sub.push(sql`r.name = ${'unattributed'}`);
    if (sub.length)   parts.push(sql`(${sql.join(sub, sql` OR `)})`);
  }
  return parts;
}

// ── Implementation ─────────────────────────────────────────────────────────────

export class EventReader implements IEventReader {
  constructor(private readonly db: Kysely<Database>) {}

  async find(filter?: RecordFilter): Promise<UsageEvent[]> {
    if (!filter) {
      const rows = await this.db.selectFrom('events').selectAll().orderBy('ts').execute();
      return rows.map(rowToEvent).filter((e): e is UsageEvent => e !== null);
    }

    const where = whereClause(filter);
    const limitSql = filter.limit ? sql.raw(` LIMIT ${filter.limit}`) : sql``;
    const offsetSql = filter.offset ? sql.raw(` OFFSET ${filter.offset}`) : sql``;

    const result = await sql<Record<string, unknown>>`
      SELECT * FROM events ${where} ORDER BY ts${limitSql}${offsetSql}
    `.execute(this.db);

    return result.rows.map(rowToEvent).filter((e): e is UsageEvent => e !== null);
  }

  async findById(id: string): Promise<UsageEvent | null> {
    const row = await this.db
      .selectFrom('events')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? rowToEvent(row as Record<string, unknown>) : null;
  }

  async count(filter?: RecordFilter): Promise<number> {
    if (!filter) {
      const row = await this.db
        .selectFrom('events')
        .select((eb) => eb.fn.countAll().as('c'))
        .executeTakeFirst();
      return Number(row?.c ?? 0);
    }

    const where = whereClause(filter);
    const result = await sql<{ c: number | bigint }>`
      SELECT count(*) AS c FROM events ${where}
    `.execute(this.db);
    return Number(result.rows[0]?.c ?? 0);
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

    const where = whereClause(filter);
    const selectRaw = sql.raw(selects.join(', '));
    const result = await sql<Record<string, unknown>>`
      SELECT COUNT(*) AS total, ${selectRaw} FROM events ${where}
    `.execute(this.db);

    const row = result.rows[0] ?? {};
    const out: AggregateResult = {
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
    const where = whereClause(filter);
    let keyExpr: string;
    switch (by) {
      case 'hour':    keyExpr = "strftime(to_timestamp(ts / 1000), '%H')"; break;
      case 'weekday': keyExpr = 'CAST(dayofweek(to_timestamp(ts / 1000)) AS VARCHAR)'; break;
      case 'week':    keyExpr = "strftime(date_trunc('week', to_timestamp(ts / 1000)), '%Y-%m-%d')"; break;
      case 'month':   keyExpr = "strftime(date_trunc('month', to_timestamp(ts / 1000)), '%Y-%m')"; break;
      default:        keyExpr = "strftime(to_timestamp(ts / 1000), '%Y-%m-%d')";
    }

    const result = await sql<Record<string, unknown>>`
      SELECT
        ${sql.raw(keyExpr)} AS bucket_key,
        COALESCE(SUM(credits), 0)                                                           AS credits,
        COALESCE(SUM(cost), 0)                                                              AS cost,
        COALESCE(SUM(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0)), 0)        AS tokens,
        COUNT(*)                                                                             AS event_count
      FROM events ${where}
      GROUP BY bucket_key
      ORDER BY bucket_key
    `.execute(this.db);

    /* c8 ignore start */
    return result.rows.map((r) => ({
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
    const where = whereClause(filter);

    const colResult = await sql<Record<string, unknown>>`
      SELECT DISTINCT ${sql.raw(safeOn)} AS col FROM events ${where} ORDER BY col
    `.execute(this.db);

    /* c8 ignore next */
    const columnKeys = colResult.rows.map((r) => String(r['col'] ?? '')).filter(Boolean);
    if (columnKeys.length === 0) return { rows: [], columnKeys: [] };

    const pivotCols = columnKeys.map(
      (k) =>
        `COALESCE(SUM(CASE WHEN ${safeOn} = '${k.replace(/'/g, "''")}' THEN ${safeValue} ELSE 0 END), 0) AS "${k}"`,
    );

    const dataResult = await sql<Record<string, unknown>>`
      SELECT modelId, ${sql.raw(pivotCols.join(', '))}
      FROM events ${where}
      GROUP BY modelId
      ORDER BY SUM(${sql.raw(safeValue)}) DESC
    `.execute(this.db);

    return {
      /* c8 ignore start */
      rows: dataResult.rows.map((r) => {
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
    const where = whereClause(filter);

    const result = await sql<Record<string, unknown>>`
      SELECT
        modelId AS rank_key,
        COALESCE(SUM(credits), 0) AS credits,
        COALESCE(SUM(cost), 0)    AS cost,
        COALESCE(SUM(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0)), 0) AS tokens
      FROM events ${where}
      GROUP BY modelId
      ORDER BY SUM(${sql.raw(safeBy)}) DESC
      LIMIT ${sql.raw(String(limit))}
    `.execute(this.db);

    /* c8 ignore start */
    return result.rows.map((r) => ({
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
    const wParts = buildFactsWhereParts(filter);
    const whereSql = wParts.length > 0 ? sql`WHERE ${sql.join(wParts, sql` AND `)}` : sql``;

    const result = await sql<Record<string, unknown>>`
      SELECT
        d.date,
        SUM(f.credits)       AS credits,
        SUM(f.cost)          AS cost,
        SUM(f.tokens)        AS tokens,
        SUM(f.event_count)   AS event_count,
        SUM(f.cost_input)    AS cost_input,
        SUM(f.cost_output)   AS cost_output,
        SUM(f.cost_cache_read)  AS cost_cache_read,
        SUM(f.cost_cache_write) AS cost_cache_write,
        SUM(f.cost_thinking) AS cost_thinking,
        SUM(f.cost_tool)     AS cost_tool
      FROM fact_daily_usage f
      JOIN dim_date    d  ON d.id  = f.date_id
      JOIN dim_model   m  ON m.id  = f.model_id
      JOIN dim_surface sf ON sf.id = f.surface_id
      JOIN dim_source  sc ON sc.id = f.source_id
      JOIN dim_repo    r  ON r.id  = f.repo_id
      ${whereSql}
      GROUP BY d.date
      ORDER BY d.date
    `.execute(this.db);

    /* c8 ignore next 14 */
    return result.rows.map((row) => ({
      day:           String(row['date']           ?? ''),
      credits:       Number(row['credits']        ?? 0),
      cost:          Number(row['cost']           ?? 0),
      tokens:        Number(row['tokens']         ?? 0),
      eventCount:    Number(row['event_count']    ?? 0),
      costInput:     Number(row['cost_input']     ?? 0),
      costOutput:    Number(row['cost_output']    ?? 0),
      costCacheRead: Number(row['cost_cache_read'] ?? 0),
      costCacheWrite:Number(row['cost_cache_write'] ?? 0),
      costThinking:  Number(row['cost_thinking']  ?? 0),
      costTool:      Number(row['cost_tool']      ?? 0),
    }));
  }
}

function emptyAggregate(): AggregateResult {
  return { count: 0, sum: {}, mean: {}, stddev: {}, p50: {}, p95: {}, min: {}, max: {} };
}

// re-export so callers don't need a separate import
export type { RecordFilter, AggregateResult, BucketBy, CrossTab, TimeBucket };
export { DAY_MS };
