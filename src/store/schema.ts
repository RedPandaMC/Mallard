export const STORE_SCHEMA_VERSION = 5;

/** Keep this many days of raw, per-request events before rolling up. */
export const RAW_WINDOW_DAYS = 90;

/** Force a rollup if the raw event count ever exceeds this. */
export const MAX_RAW_EVENTS = 50_000;

// ── DDL ───────────────────────────────────────────────────────────────────────

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

  -- Staging table for bulk Appender inserts (no PK, so DuckDB skips constraint checks).
  CREATE TABLE IF NOT EXISTS events_staging (
    id VARCHAR, ts BIGINT NOT NULL, modelId VARCHAR NOT NULL,
    surface VARCHAR NOT NULL, source VARCHAR NOT NULL,
    credits DOUBLE NOT NULL, cost DOUBLE NOT NULL,
    promptTokens INTEGER, completionTokens INTEGER,
    estimated BOOLEAN NOT NULL DEFAULT TRUE,
    repo VARCHAR, costByCategory VARCHAR, branch VARCHAR
  );

  -- Normalization view: NULLs resolved, json cost categories extracted.
  CREATE OR REPLACE VIEW v_events AS
    SELECT
      id, ts, modelId, surface, source,
      repo,
      COALESCE(repo, 'unattributed')   AS repo_label,
      credits, cost, estimated,
      COALESCE(promptTokens, 0)        AS prompt_tokens,
      COALESCE(completionTokens, 0)    AS completion_tokens,
      id LIKE 'roll:%'                 AS is_rolled,
      COALESCE(TRY_CAST(json_extract_string(costByCategory, '$.input')          AS DOUBLE), 0) AS cost_input,
      COALESCE(TRY_CAST(json_extract_string(costByCategory, '$.output')         AS DOUBLE), 0) AS cost_output,
      COALESCE(TRY_CAST(json_extract_string(costByCategory, '$.cache_read')     AS DOUBLE), 0) AS cost_cache_read,
      COALESCE(TRY_CAST(json_extract_string(costByCategory, '$.cache_creation') AS DOUBLE), 0) AS cost_cache_write,
      COALESCE(TRY_CAST(json_extract_string(costByCategory, '$.thinking')       AS DOUBLE), 0) AS cost_thinking,
      COALESCE(TRY_CAST(json_extract_string(costByCategory, '$.tool')           AS DOUBLE), 0) AS cost_tool
    FROM events;

  -- Local-calendar-day grouping (DST-correct via session TimeZone).
  CREATE OR REPLACE VIEW v_usage_daily AS
    SELECT
      strftime(to_timestamp(e.ts / 1000.0)::TIMESTAMPTZ, '%Y-%m-%d') AS day,
      e.modelId, e.surface, e.source,
      e.repo_label                                                     AS repo,
      SUM(e.credits)                                                   AS credits,
      SUM(e.cost)                                                      AS cost,
      SUM(e.prompt_tokens)                                             AS prompt_tokens,
      SUM(e.completion_tokens)                                         AS completion_tokens,
      COUNT(*)                                                         AS event_count,
      SUM(e.cost_input)                                                AS cost_input,
      SUM(e.cost_output)                                               AS cost_output,
      SUM(e.cost_cache_read)                                           AS cost_cache_read,
      SUM(e.cost_cache_write)                                          AS cost_cache_write,
      SUM(e.cost_thinking)                                             AS cost_thinking,
      SUM(e.cost_tool)                                                 AS cost_tool
    FROM v_events e
    GROUP BY strftime(to_timestamp(e.ts / 1000.0)::TIMESTAMPTZ, '%Y-%m-%d'),
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

  -- Local-hour grouping (DST-correct via session TimeZone).
  CREATE OR REPLACE VIEW v_usage_hourly AS
    SELECT
      CAST(strftime(to_timestamp(e.ts / 1000.0)::TIMESTAMPTZ, '%H') AS INTEGER) AS hour_local,
      e.modelId, e.surface, e.source, e.repo_label                               AS repo,
      SUM(e.credits) AS credits, SUM(e.cost) AS cost, COUNT(*) AS event_count
    FROM v_events e
    GROUP BY CAST(strftime(to_timestamp(e.ts / 1000.0)::TIMESTAMPTZ, '%H') AS INTEGER),
             e.modelId, e.surface, e.source, e.repo_label;

  CREATE OR REPLACE VIEW v_usage_by_weekday AS
    SELECT
      CAST(dayofweek(to_timestamp(e.ts / 1000.0)::TIMESTAMPTZ) AS INTEGER) AS weekday,
      e.modelId, e.surface, e.source, e.repo_label                          AS repo,
      SUM(e.credits) AS credits, SUM(e.cost) AS cost, COUNT(*) AS event_count
    FROM v_events e
    GROUP BY CAST(dayofweek(to_timestamp(e.ts / 1000.0)::TIMESTAMPTZ) AS INTEGER),
             e.modelId, e.surface, e.source, e.repo_label;

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

  -- Daily rollup view — groups raw events by local calendar day.
  CREATE OR REPLACE VIEW v_daily_rollup AS
    SELECT
      'roll:' || strftime(to_timestamp(MIN(e.ts) / 1000.0)::TIMESTAMPTZ, '%Y-%m-%d')
        || ':' || e.modelId
        || ':' || COALESCE(e.repo, 'unattributed')
        || ':' || e.surface
        || ':' || e.source                                                  AS id,
      CAST(extract(epoch from date_trunc('day', to_timestamp(MIN(e.ts) / 1000.0)::TIMESTAMPTZ)) * 1000 AS BIGINT) AS ts,
      e.modelId, e.surface, e.source, e.repo,
      SUM(e.credits)                                                         AS credits,
      SUM(e.cost)                                                            AS cost,
      CAST(SUM(e.prompt_tokens) AS INTEGER)                                  AS promptTokens,
      CAST(SUM(e.completion_tokens) AS INTEGER)                              AS completionTokens,
      true                                                                   AS estimated,
      NULL::VARCHAR                                                          AS costByCategory,
      NULL::VARCHAR                                                          AS branch
    FROM v_events e
    WHERE NOT e.is_rolled
    GROUP BY strftime(to_timestamp(e.ts / 1000.0)::TIMESTAMPTZ, '%Y-%m-%d'),
             e.modelId, e.surface, e.source, e.repo;

  -- ── Star schema ──────────────────────────────────────────────────────────────
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

  -- ── Snapshot cache ───────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS snap_totals (
    period      VARCHAR PRIMARY KEY,
    credits     DOUBLE  NOT NULL DEFAULT 0,
    cost        DOUBLE  NOT NULL DEFAULT 0,
    tokens      BIGINT  NOT NULL DEFAULT 0,
    event_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS snap_daily (
    day_start   BIGINT  PRIMARY KEY,
    credits     DOUBLE  NOT NULL DEFAULT 0,
    cost        DOUBLE  NOT NULL DEFAULT 0,
    tokens      BIGINT  NOT NULL DEFAULT 0,
    event_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS snap_models (
    modelId VARCHAR PRIMARY KEY,
    credits DOUBLE  NOT NULL DEFAULT 0,
    cost    DOUBLE  NOT NULL DEFAULT 0,
    tokens  BIGINT  NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS snap_repos (
    repo    VARCHAR PRIMARY KEY,
    credits DOUBLE  NOT NULL DEFAULT 0,
    cost    DOUBLE  NOT NULL DEFAULT 0,
    tokens  BIGINT  NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS snap_hourly (
    hour_local  INTEGER PRIMARY KEY,
    credits     DOUBLE  NOT NULL DEFAULT 0,
    event_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS snap_categories (
    category VARCHAR PRIMARY KEY,
    cost     DOUBLE  NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS snap_sankey (
    model   VARCHAR NOT NULL,
    surface VARCHAR NOT NULL,
    count   INTEGER NOT NULL DEFAULT 0,
    credits DOUBLE  NOT NULL DEFAULT 0,
    PRIMARY KEY (model, surface)
  );
  CREATE TABLE IF NOT EXISTS snap_dim_models   (name VARCHAR PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS snap_dim_surfaces (name VARCHAR PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS snap_dim_sources  (name VARCHAR PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS snap_dim_repos    (name VARCHAR PRIMARY KEY);
`;

// ── DML: staging merge ────────────────────────────────────────────────────────

export const INSERT_STAGING_MERGE = `INSERT OR IGNORE INTO events SELECT * FROM events_staging`;
export const CLEAR_STAGING        = `DELETE FROM events_staging`;
export const COUNT_EVENTS_SQL     = `SELECT COUNT(*) AS c FROM events`;

// ── DML: meta ────────────────────────────────────────────────────────────────

export const META_GET_SQL = `SELECT value FROM meta WHERE key = ?`;
export const META_SET_SQL = `
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;

// ── DML: compact ─────────────────────────────────────────────────────────────

export const COMPACT_CHECK_SQL  = `SELECT COUNT(*) AS c FROM events WHERE ts < ? AND id NOT LIKE 'roll:%'`;
export const COMPACT_ROLLUP_SQL = `
  INSERT OR IGNORE INTO events
    (id, ts, modelId, surface, source, credits, cost,
     promptTokens, completionTokens, estimated, repo, costByCategory, branch)
  SELECT id, ts, modelId, surface, source, credits, cost,
         promptTokens, completionTokens, estimated, repo, costByCategory, branch
  FROM v_daily_rollup
  WHERE ts < ?`;
export const COMPACT_DELETE_SQL = `DELETE FROM events WHERE ts < ? AND id NOT LIKE 'roll:%'`;

// ── DML: fact refresh (parameterized: windowStart BIGINT, windowEnd BIGINT) ──

export const REFRESH_FACTS_INSERT_MODELS_SQL = `
  INSERT INTO dim_model (id, name)
    SELECT CAST(nextval('seq_model_id') AS SMALLINT), modelId
    FROM (
      SELECT DISTINCT modelId FROM events
      WHERE modelId NOT IN (SELECT name FROM dim_model)
    ) sub`;

export const REFRESH_FACTS_INSERT_REPOS_SQL = `
  INSERT INTO dim_repo (id, name)
    SELECT CAST(nextval('seq_repo_id') AS SMALLINT), repo_label
    FROM (
      SELECT DISTINCT COALESCE(repo, 'unattributed') AS repo_label FROM events
      WHERE COALESCE(repo, 'unattributed') NOT IN (SELECT name FROM dim_repo)
    ) sub`;

export const REFRESH_FACTS_SQL = `
  INSERT OR REPLACE INTO fact_daily_usage
    (date_id, model_id, surface_id, source_id, repo_id,
     credits, cost, tokens, event_count,
     cost_input, cost_output, cost_cache_read, cost_cache_write, cost_thinking, cost_tool)
  SELECT
    CAST(strftime(to_timestamp(e.ts / 1000.0)::TIMESTAMPTZ, '%Y%m%d') AS INTEGER) AS date_id,
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
  GROUP BY 1, 2, 3, 4, 5`;

// ── DML: snapshot cache refresh ───────────────────────────────────────────────

export const REFRESH_SNAP_SQL = `
  DELETE FROM snap_totals;
  INSERT INTO snap_totals (period, credits, cost, tokens, event_count)
    SELECT 'all',
      COALESCE(SUM(credits), 0),
      COALESCE(SUM(cost), 0),
      COALESCE(CAST(SUM(COALESCE(promptTokens,0) + COALESCE(completionTokens,0)) AS BIGINT), 0),
      COUNT(*)
    FROM events
  UNION ALL
    SELECT 'mtd',
      COALESCE(SUM(credits), 0),
      COALESCE(SUM(cost), 0),
      COALESCE(CAST(SUM(COALESCE(promptTokens,0) + COALESCE(completionTokens,0)) AS BIGINT), 0),
      COUNT(*)
    FROM events
    WHERE date_trunc('month', to_timestamp(ts/1000.0)::TIMESTAMPTZ) = date_trunc('month', now()::TIMESTAMPTZ)
  UNION ALL
    SELECT 'today',
      COALESCE(SUM(credits), 0),
      COALESCE(SUM(cost), 0),
      COALESCE(CAST(SUM(COALESCE(promptTokens,0) + COALESCE(completionTokens,0)) AS BIGINT), 0),
      COUNT(*)
    FROM events
    WHERE date_trunc('day', to_timestamp(ts/1000.0)::TIMESTAMPTZ) = date_trunc('day', now()::TIMESTAMPTZ);

  DELETE FROM snap_daily;
  INSERT INTO snap_daily (day_start, credits, cost, tokens, event_count)
    SELECT
      CAST(extract(epoch from date_trunc('day', to_timestamp(ts/1000.0)::TIMESTAMPTZ)) * 1000 AS BIGINT) AS day_start,
      COALESCE(SUM(credits), 0),
      COALESCE(SUM(cost), 0),
      COALESCE(CAST(SUM(COALESCE(promptTokens,0) + COALESCE(completionTokens,0)) AS BIGINT), 0),
      COUNT(*)
    FROM events
    WHERE to_timestamp(ts/1000.0)::TIMESTAMPTZ >= date_trunc('day', now()::TIMESTAMPTZ) - INTERVAL '90 days'
    GROUP BY day_start
    ORDER BY day_start;

  DELETE FROM snap_models;
  INSERT INTO snap_models (modelId, credits, cost, tokens)
    SELECT
      modelId,
      COALESCE(SUM(credits), 0),
      COALESCE(SUM(cost), 0),
      COALESCE(CAST(SUM(COALESCE(promptTokens,0) + COALESCE(completionTokens,0)) AS BIGINT), 0)
    FROM events
    GROUP BY modelId
    ORDER BY SUM(credits) DESC
    LIMIT 10;

  DELETE FROM snap_repos;
  INSERT INTO snap_repos (repo, credits, cost, tokens)
    SELECT
      COALESCE(repo, 'unattributed') AS repo,
      COALESCE(SUM(credits), 0),
      COALESCE(SUM(cost), 0),
      COALESCE(CAST(SUM(COALESCE(promptTokens,0) + COALESCE(completionTokens,0)) AS BIGINT), 0)
    FROM events
    GROUP BY COALESCE(repo, 'unattributed')
    ORDER BY SUM(credits) DESC
    LIMIT 10;

  DELETE FROM snap_hourly;
  INSERT INTO snap_hourly (hour_local, credits, event_count)
    SELECT
      CAST(strftime(to_timestamp(ts/1000.0)::TIMESTAMPTZ, '%H') AS INTEGER) AS hour_local,
      COALESCE(SUM(credits), 0),
      COUNT(*)
    FROM events
    GROUP BY hour_local
    ORDER BY hour_local;

  DELETE FROM snap_categories;
  INSERT INTO snap_categories (category, cost)
    SELECT cat, total FROM (
      SELECT 'input' AS cat, COALESCE(SUM(COALESCE(TRY_CAST(json_extract_string(costByCategory,'$.input') AS DOUBLE),0)),0) AS total FROM events
      UNION ALL SELECT 'output',         COALESCE(SUM(COALESCE(TRY_CAST(json_extract_string(costByCategory,'$.output') AS DOUBLE),0)),0) FROM events
      UNION ALL SELECT 'cache_read',     COALESCE(SUM(COALESCE(TRY_CAST(json_extract_string(costByCategory,'$.cache_read') AS DOUBLE),0)),0) FROM events
      UNION ALL SELECT 'cache_creation', COALESCE(SUM(COALESCE(TRY_CAST(json_extract_string(costByCategory,'$.cache_creation') AS DOUBLE),0)),0) FROM events
      UNION ALL SELECT 'thinking',       COALESCE(SUM(COALESCE(TRY_CAST(json_extract_string(costByCategory,'$.thinking') AS DOUBLE),0)),0) FROM events
      UNION ALL SELECT 'tool',           COALESCE(SUM(COALESCE(TRY_CAST(json_extract_string(costByCategory,'$.tool') AS DOUBLE),0)),0) FROM events
    )
    WHERE total > 0;

  DELETE FROM snap_sankey;
  INSERT INTO snap_sankey (model, surface, count, credits)
    SELECT modelId, surface, COUNT(*), COALESCE(SUM(credits), 0)
    FROM events
    GROUP BY modelId, surface;

  DELETE FROM snap_dim_models;   INSERT INTO snap_dim_models   (name) SELECT DISTINCT modelId FROM events;
  DELETE FROM snap_dim_surfaces; INSERT INTO snap_dim_surfaces (name) SELECT DISTINCT surface FROM events;
  DELETE FROM snap_dim_sources;  INSERT INTO snap_dim_sources  (name) SELECT DISTINCT source  FROM events;
  DELETE FROM snap_dim_repos;    INSERT INTO snap_dim_repos    (name) SELECT DISTINCT COALESCE(repo, 'unattributed') FROM events;
`;

// ── DML: clear ────────────────────────────────────────────────────────────────

export const CLEAR_ALL_SQL = `
  DELETE FROM events;
  DELETE FROM meta;
  DELETE FROM fact_daily_usage;
  DELETE FROM dim_model;
  DELETE FROM dim_repo;
  DELETE FROM events_staging;
  DELETE FROM snap_totals;
  DELETE FROM snap_daily;
  DELETE FROM snap_models;
  DELETE FROM snap_repos;
  DELETE FROM snap_hourly;
  DELETE FROM snap_categories;
  DELETE FROM snap_sankey;
  DELETE FROM snap_dim_models;
  DELETE FROM snap_dim_surfaces;
  DELETE FROM snap_dim_sources;
  DELETE FROM snap_dim_repos;
`;

// ── Queries: events ───────────────────────────────────────────────────────────

export const FIND_ALL_SQL    = `SELECT * FROM events ORDER BY ts`;
export const FIND_BY_ID_SQL  = `SELECT * FROM events WHERE id = ?`;
export const COUNT_ALL_SQL   = `SELECT COUNT(*) AS c FROM events`;

// ── Queries: branch credits ───────────────────────────────────────────────────

export const CREDITS_BY_BRANCH_SQL = `SELECT COALESCE(SUM(credits), 0) AS c FROM events WHERE branch = ?`;

// ── Queries: snapshot cache reads ────────────────────────────────────────────

export const READ_SNAP_TOTALS      = `SELECT period, credits, cost, tokens, event_count FROM snap_totals`;
export const READ_SNAP_DAILY       = `SELECT day_start, credits, cost, tokens, event_count FROM snap_daily ORDER BY day_start`;
export const READ_SNAP_MODELS      = `SELECT modelId, credits, cost, tokens FROM snap_models`;
export const READ_SNAP_REPOS       = `SELECT repo, credits, cost, tokens FROM snap_repos`;
export const READ_SNAP_HOURLY      = `SELECT hour_local, credits, event_count FROM snap_hourly ORDER BY hour_local`;
export const READ_SNAP_CATEGORIES  = `SELECT category, cost FROM snap_categories`;
export const READ_SNAP_SANKEY      = `SELECT model, surface, count, credits FROM snap_sankey`;
export const READ_SNAP_DIM_MODELS  = `SELECT name FROM snap_dim_models`;
export const READ_SNAP_DIM_SURFACES= `SELECT name FROM snap_dim_surfaces`;
export const READ_SNAP_DIM_SOURCES = `SELECT name FROM snap_dim_sources`;
export const READ_SNAP_DIM_REPOS   = `SELECT name FROM snap_dim_repos`;

// ── Queries: queryFacts (parameterized via fact tables) ───────────────────────

export const QUERY_FACTS_BASE_SQL = `
  SELECT
    d.date,
    SUM(f.credits)          AS credits,
    SUM(f.cost)             AS cost,
    SUM(f.tokens)           AS tokens,
    SUM(f.event_count)      AS event_count,
    SUM(f.cost_input)       AS cost_input,
    SUM(f.cost_output)      AS cost_output,
    SUM(f.cost_cache_read)  AS cost_cache_read,
    SUM(f.cost_cache_write) AS cost_cache_write,
    SUM(f.cost_thinking)    AS cost_thinking,
    SUM(f.cost_tool)        AS cost_tool
  FROM fact_daily_usage f
  JOIN dim_date    d  ON d.id  = f.date_id
  JOIN dim_model   m  ON m.id  = f.model_id
  JOIN dim_surface sf ON sf.id = f.surface_id
  JOIN dim_source  sc ON sc.id = f.source_id
  JOIN dim_repo    r  ON r.id  = f.repo_id`;
