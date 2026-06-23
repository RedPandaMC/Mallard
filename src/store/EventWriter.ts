/* c8 ignore start */
import { Kysely } from 'kysely';
import { DuckDBConnection, DuckDBPreparedStatement } from '@duckdb/node-api';
import { UsageEvent } from '../domain/types';
import { UNATTRIBUTED_REPO } from '../domain/aggregate';
import { DAY_MS, startOf } from '../util/time';
import { MAX_RAW_EVENTS, RAW_WINDOW_DAYS } from './schema';
import type { RecordFilter } from './EventRepository';
import type { Database } from './db-types';
/* c8 ignore stop */

// ── Schema ─────────────────────────────────────────────────────────────────────

export const CREATE_SQL = `
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

  CREATE TABLE IF NOT EXISTS prices (
    modelId VARCHAR PRIMARY KEY,
    multiplier DOUBLE NOT NULL DEFAULT 1
  );

  -- Normalization view: NULLs resolved, json cost categories extracted via DuckDB json extension.
  CREATE OR REPLACE VIEW v_events AS
    SELECT
      id, ts, modelId, surface, source,
      repo,
      COALESCE(repo, 'unattributed')   AS repo_label,
      credits, cost, estimated,
      COALESCE(promptTokens, 0)        AS prompt_tokens,
      COALESCE(completionTokens, 0)    AS completion_tokens,
      id LIKE 'roll:%'                 AS is_rolled,
      COALESCE(TRY_CAST(json_extract_string(costByCategory, '$.input')        AS DOUBLE), 0) AS cost_input,
      COALESCE(TRY_CAST(json_extract_string(costByCategory, '$.output')       AS DOUBLE), 0) AS cost_output,
      COALESCE(TRY_CAST(json_extract_string(costByCategory, '$.cache_read')   AS DOUBLE), 0) AS cost_cache_read,
      COALESCE(TRY_CAST(json_extract_string(costByCategory, '$.cache_write')  AS DOUBLE), 0) AS cost_cache_write,
      COALESCE(TRY_CAST(json_extract_string(costByCategory, '$.thinking')     AS DOUBLE), 0) AS cost_thinking,
      COALESCE(TRY_CAST(json_extract_string(costByCategory, '$.tool')         AS DOUBLE), 0) AS cost_tool
    FROM events;

  -- UTC day × 5 dims over ALL events (raw + rolled).
  CREATE OR REPLACE VIEW v_usage_daily AS
    SELECT
      strftime(to_timestamp(e.ts / 1000), '%Y-%m-%d') AS day,
      e.modelId, e.surface, e.source,
      e.repo_label                                     AS repo,
      SUM(e.credits)                                   AS credits,
      SUM(e.cost)                                      AS cost,
      SUM(e.prompt_tokens)                             AS prompt_tokens,
      SUM(e.completion_tokens)                         AS completion_tokens,
      COUNT(*)                                         AS event_count,
      SUM(e.cost_input)                                AS cost_input,
      SUM(e.cost_output)                               AS cost_output,
      SUM(e.cost_cache_read)                           AS cost_cache_read,
      SUM(e.cost_cache_write)                          AS cost_cache_write,
      SUM(e.cost_thinking)                             AS cost_thinking,
      SUM(e.cost_tool)                                 AS cost_tool
    FROM v_events e
    GROUP BY strftime(to_timestamp(e.ts / 1000), '%Y-%m-%d'),
             e.modelId, e.surface, e.source, e.repo_label;

  CREATE OR REPLACE VIEW v_usage_weekly AS
    SELECT
      strftime(date_trunc('week', day::DATE), '%Y-%m-%d') AS week_start,
      modelId, surface, source, repo,
      SUM(credits)           AS credits,
      SUM(cost)              AS cost,
      SUM(prompt_tokens)     AS prompt_tokens,
      SUM(completion_tokens) AS completion_tokens,
      SUM(event_count)       AS event_count,
      SUM(cost_input)        AS cost_input,
      SUM(cost_output)       AS cost_output,
      SUM(cost_cache_read)   AS cost_cache_read,
      SUM(cost_cache_write)  AS cost_cache_write,
      SUM(cost_thinking)     AS cost_thinking,
      SUM(cost_tool)         AS cost_tool
    FROM v_usage_daily
    GROUP BY date_trunc('week', day::DATE), modelId, surface, source, repo;

  CREATE OR REPLACE VIEW v_usage_monthly AS
    SELECT
      LEFT(day, 7)           AS month,
      modelId, surface, source, repo,
      SUM(credits)           AS credits,
      SUM(cost)              AS cost,
      SUM(prompt_tokens)     AS prompt_tokens,
      SUM(completion_tokens) AS completion_tokens,
      SUM(event_count)       AS event_count,
      SUM(cost_input)        AS cost_input,
      SUM(cost_output)       AS cost_output,
      SUM(cost_cache_read)   AS cost_cache_read,
      SUM(cost_cache_write)  AS cost_cache_write,
      SUM(cost_thinking)     AS cost_thinking,
      SUM(cost_tool)         AS cost_tool
    FROM v_usage_daily
    GROUP BY LEFT(day, 7), modelId, surface, source, repo;

  CREATE OR REPLACE VIEW v_usage_hourly AS
    SELECT
      CAST(strftime(to_timestamp(e.ts / 1000), '%H') AS INTEGER) AS hour_utc,
      e.modelId, e.surface, e.source, e.repo_label               AS repo,
      SUM(e.credits) AS credits, SUM(e.cost) AS cost, COUNT(*) AS event_count
    FROM v_events e
    GROUP BY CAST(strftime(to_timestamp(e.ts / 1000), '%H') AS INTEGER),
             e.modelId, e.surface, e.source, e.repo_label;

  CREATE OR REPLACE VIEW v_usage_by_weekday AS
    SELECT
      CAST(dayofweek(to_timestamp(e.ts / 1000)) AS INTEGER) AS weekday,
      e.modelId, e.surface, e.source, e.repo_label          AS repo,
      SUM(e.credits) AS credits, SUM(e.cost) AS cost, COUNT(*) AS event_count
    FROM v_events e
    GROUP BY CAST(dayofweek(to_timestamp(e.ts / 1000)) AS INTEGER),
             e.modelId, e.surface, e.source, e.repo_label;

  -- Cost breakdown by category, summed across all models.
  CREATE OR REPLACE VIEW v_cost_by_category AS
    SELECT
      repo_label AS repo,
      SUM(cost_input)       AS cost_input,
      SUM(cost_output)      AS cost_output,
      SUM(cost_cache_read)  AS cost_cache_read,
      SUM(cost_cache_write) AS cost_cache_write,
      SUM(cost_thinking)    AS cost_thinking,
      SUM(cost_tool)        AS cost_tool
    FROM v_events
    GROUP BY repo_label;

  CREATE OR REPLACE VIEW v_daily_rollup AS
    SELECT
      'roll:' || strftime(to_timestamp(MIN(e.ts) / 1000), '%Y-%m-%d')
        || ':' || e.modelId
        || ':' || COALESCE(e.repo, 'unattributed')
        || ':' || e.surface
        || ':' || e.source                             AS id,
      MIN(e.ts) / 86400000 * 86400000                  AS ts,
      e.modelId, e.surface, e.source, e.repo,
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

  -- ── Star schema ───────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS dim_surface (id TINYINT PRIMARY KEY, name VARCHAR UNIQUE NOT NULL);
  INSERT OR IGNORE INTO dim_surface VALUES (0,'chat'),(1,'inline'),(2,'agent'),(3,'edit'),(4,'unknown');

  CREATE TABLE IF NOT EXISTS dim_source (id TINYINT PRIMARY KEY, name VARCHAR UNIQUE NOT NULL);
  INSERT OR IGNORE INTO dim_source VALUES (0,'lm'),(1,'local'),(2,'github'),(3,'claude-code');

  CREATE SEQUENCE IF NOT EXISTS seq_model_id INCREMENT 1;
  CREATE TABLE IF NOT EXISTS dim_model (id SMALLINT PRIMARY KEY, name VARCHAR UNIQUE NOT NULL);

  CREATE SEQUENCE IF NOT EXISTS seq_repo_id INCREMENT 1;
  CREATE TABLE IF NOT EXISTS dim_repo (id SMALLINT PRIMARY KEY, name VARCHAR UNIQUE NOT NULL);

  CREATE TABLE IF NOT EXISTS dim_date (
    id          INTEGER  PRIMARY KEY,
    date        VARCHAR  UNIQUE NOT NULL,
    year        SMALLINT NOT NULL,
    month       TINYINT  NOT NULL,
    week        TINYINT  NOT NULL,
    day_of_week TINYINT  NOT NULL
  );
  INSERT OR IGNORE INTO dim_date (id, date, year, month, week, day_of_week)
    SELECT
      CAST(strftime((CURRENT_DATE - INTERVAL '730 days' + n * INTERVAL '1 day')::DATE, '%Y%m%d') AS INTEGER),
      strftime((CURRENT_DATE - INTERVAL '730 days' + n * INTERVAL '1 day')::DATE, '%Y-%m-%d'),
      CAST(year((CURRENT_DATE - INTERVAL '730 days' + n * INTERVAL '1 day')::DATE)        AS SMALLINT),
      CAST(month((CURRENT_DATE - INTERVAL '730 days' + n * INTERVAL '1 day')::DATE)       AS TINYINT),
      CAST(weekofyear((CURRENT_DATE - INTERVAL '730 days' + n * INTERVAL '1 day')::DATE)  AS TINYINT),
      CAST(dayofweek((CURRENT_DATE - INTERVAL '730 days' + n * INTERVAL '1 day')::DATE)   AS TINYINT)
    FROM generate_series(0, 1460) AS t(n);

  CREATE TABLE IF NOT EXISTS fact_daily_usage (
    date_id     INTEGER  NOT NULL,
    model_id    SMALLINT NOT NULL,
    surface_id  TINYINT  NOT NULL,
    source_id   TINYINT  NOT NULL,
    repo_id     SMALLINT NOT NULL,
    credits     DOUBLE   NOT NULL DEFAULT 0,
    cost        DOUBLE   NOT NULL DEFAULT 0,
    tokens      BIGINT   NOT NULL DEFAULT 0,
    event_count INTEGER  NOT NULL DEFAULT 0,
    PRIMARY KEY (date_id, model_id, surface_id, source_id, repo_id)
  );
  ALTER TABLE fact_daily_usage ADD COLUMN IF NOT EXISTS cost_input        DOUBLE DEFAULT 0;
  ALTER TABLE fact_daily_usage ADD COLUMN IF NOT EXISTS cost_output       DOUBLE DEFAULT 0;
  ALTER TABLE fact_daily_usage ADD COLUMN IF NOT EXISTS cost_cache_read   DOUBLE DEFAULT 0;
  ALTER TABLE fact_daily_usage ADD COLUMN IF NOT EXISTS cost_cache_write  DOUBLE DEFAULT 0;
  ALTER TABLE fact_daily_usage ADD COLUMN IF NOT EXISTS cost_thinking     DOUBLE DEFAULT 0;
  ALTER TABLE fact_daily_usage ADD COLUMN IF NOT EXISTS cost_tool         DOUBLE DEFAULT 0;
`;

const INSERT_SQL = `INSERT OR IGNORE INTO events
  (id, ts, modelId, surface, source, credits, cost, promptTokens, completionTokens, estimated, repo, costByCategory, branch)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`;

// ── Interface ─────────────────────────────────────────────────────────────────

export interface IEventWriter {
  insert(records: UsageEvent[]): Promise<number>;
  remove(filter: RecordFilter): Promise<number>;
  compact(now?: number): Promise<void>;
  clear(): Promise<void>;
  setPrices(entries: ReadonlyArray<{ modelId: string; multiplier: number }>): Promise<void>;
}

// ── Implementation ─────────────────────────────────────────────────────────────

export class EventWriter implements IEventWriter {
  constructor(
    private readonly conn: DuckDBConnection,
    private readonly db: Kysely<Database>,
  ) {}

  async insert(records: UsageEvent[]): Promise<number> {
    if (records.length === 0) return 0;
    const inserted = await this.insertAll(records);
    const total = await this.db
      .selectFrom('events')
      .select((eb) => eb.fn.countAll().as('c'))
      .executeTakeFirst();
    /* c8 ignore next */
    if (Number(total?.c ?? 0) > MAX_RAW_EVENTS) await this.compact();
    const todayStart = startOf(Date.now(), 'day');
    await this.refreshFacts(todayStart, todayStart + DAY_MS);
    return inserted;
  }

  async remove(filter: RecordFilter): Promise<number> {
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
    if (filter.sources?.length) {
      clauses.push(`source IN (${filter.sources.map(() => '?').join(',')})`);
      params.push(...filter.sources);
    }
    if (filter.branches?.length) {
      clauses.push(`branch IN (${filter.branches.map(() => '?').join(',')})`);
      params.push(...filter.branches);
    }
    if (filter.repos?.length) {
      const named = filter.repos.filter((r) => r !== UNATTRIBUTED_REPO);
      const hasUnattr = filter.repos.includes(UNATTRIBUTED_REPO);
      const repoParts: string[] = [];
      if (named.length) {
        repoParts.push(`repo IN (${named.map(() => '?').join(',')})`);
        params.push(...named);
      }
      if (hasUnattr) repoParts.push('repo IS NULL');
      if (repoParts.length) clauses.push(`(${repoParts.join(' OR ')})`);
    }
    if (!clauses.length) return 0; // safety guard

    const where = `WHERE ${clauses.join(' AND ')}`;
    const before = Number(
      (await this.db.selectFrom('events').select((eb) => eb.fn.countAll().as('c')).executeTakeFirst())?.c ?? 0,
    );
    const prep = await this.conn.prepare(`DELETE FROM events ${where}`);
    params.forEach((p, i) => bindParam(prep, i + 1, p));
    await prep.run();
    const after = Number(
      (await this.db.selectFrom('events').select((eb) => eb.fn.countAll().as('c')).executeTakeFirst())?.c ?? 0,
    );
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

    await this.refreshFacts();
  }

  async clear(): Promise<void> {
    await this.db.deleteFrom('events').execute();
    await this.db.deleteFrom('meta').execute();
    await this.db.deleteFrom('fact_daily_usage').execute();
    await this.db.deleteFrom('dim_model').execute();
    await this.db.deleteFrom('dim_repo').execute();
  }

  async setPrices(entries: ReadonlyArray<{ modelId: string; multiplier: number }>): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('prices').execute();
      if (entries.length > 0) {
        await trx.insertInto('prices').values(entries.map((e) => ({ ...e }))).execute();
      }
    });
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

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

  private async refreshFacts(windowStart = 0, windowEnd = Date.now() + DAY_MS): Promise<void> {
    await this.conn.run(`
      INSERT INTO dim_model (id, name)
        SELECT CAST(nextval('seq_model_id') AS SMALLINT), modelId
        FROM (
          SELECT DISTINCT modelId FROM events
          WHERE modelId NOT IN (SELECT name FROM dim_model)
        ) sub
    `);

    await this.conn.run(`
      INSERT INTO dim_repo (id, name)
        SELECT CAST(nextval('seq_repo_id') AS SMALLINT), repo_label
        FROM (
          SELECT DISTINCT COALESCE(repo, 'unattributed') AS repo_label FROM events
          WHERE COALESCE(repo, 'unattributed') NOT IN (SELECT name FROM dim_repo)
        ) sub
    `);

    const prep = await this.conn.prepare(`
      INSERT OR REPLACE INTO fact_daily_usage
        (date_id, model_id, surface_id, source_id, repo_id,
         credits, cost, tokens, event_count,
         cost_input, cost_output, cost_cache_read, cost_cache_write, cost_thinking, cost_tool)
      SELECT
        CAST(strftime(to_timestamp(e.ts / 1000), '%Y%m%d') AS INTEGER) AS date_id,
        m.id, sf.id, sc.id, r.id,
        SUM(e.credits),
        SUM(e.cost),
        CAST(SUM(e.prompt_tokens + e.completion_tokens) AS BIGINT),
        COUNT(*),
        SUM(e.cost_input),
        SUM(e.cost_output),
        SUM(e.cost_cache_read),
        SUM(e.cost_cache_write),
        SUM(e.cost_thinking),
        SUM(e.cost_tool)
      FROM v_events e
      JOIN dim_model   m  ON m.name  = e.modelId
      JOIN dim_surface sf ON sf.name = e.surface
      JOIN dim_source  sc ON sc.name = e.source
      JOIN dim_repo    r  ON r.name  = e.repo_label
      WHERE e.ts >= ? AND e.ts < ?
      GROUP BY 1, 2, 3, 4, 5
    `);
    prep.bindBigInt(1, BigInt(windowStart));
    prep.bindBigInt(2, BigInt(windowEnd));
    await prep.run();
  }
}

// ── Bind helpers ──────────────────────────────────────────────────────────────

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

export { UNATTRIBUTED_REPO };
