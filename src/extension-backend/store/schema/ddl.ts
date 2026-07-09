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
    branch VARCHAR,
    -- How repo was determined: 'authoritative' (recorded in the source log,
    -- e.g. Claude Code's cwd), 'heuristic' (active-editor guess at parse
    -- time), or NULL when unattributed.
    attribution VARCHAR,
    -- VS Code languageId; heuristic (active editor at parse time, live rows
    -- only) unless the source log names one. NULL when undetectable.
    language VARCHAR
  );
  CREATE INDEX IF NOT EXISTS idx_ts ON events(ts);
  CREATE INDEX IF NOT EXISTS idx_model ON events(modelId);
  CREATE INDEX IF NOT EXISTS idx_ts_model_surface_source
    ON events(ts, modelId, surface, source);
  CREATE INDEX IF NOT EXISTS idx_repo   ON events(repo);
  CREATE INDEX IF NOT EXISTS idx_branch ON events(branch);

  CREATE TABLE IF NOT EXISTS meta (key VARCHAR PRIMARY KEY, value VARCHAR);
  ALTER TABLE events ADD COLUMN IF NOT EXISTS branch VARCHAR;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS attribution VARCHAR;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS language VARCHAR;

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
    repo VARCHAR, costByCategory VARCHAR, branch VARCHAR, attribution VARCHAR,
    language VARCHAR
  );
  ALTER TABLE events_staging ADD COLUMN IF NOT EXISTS attribution VARCHAR;
  ALTER TABLE events_staging ADD COLUMN IF NOT EXISTS language VARCHAR;

  -- Normalization view: NULLs resolved, json cost categories extracted.
  CREATE OR REPLACE VIEW v_events AS
    SELECT
      id, ts, modelId, surface, source,
      repo,
      attribution,
      language,
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
      NULL::VARCHAR                                                          AS branch,
      -- 'heuristic' wins lexically over 'authoritative': a rolled-up day is
      -- flagged heuristic when any contributing row was.
      MAX(e.attribution)                                                     AS attribution,
      -- Like branch, per-language detail is dropped at rollup.
      NULL::VARCHAR                                                          AS language
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
`;

// ── DML: staging merge ────────────────────────────────────────────────────────

export const INSERT_STAGING_MERGE = `INSERT OR IGNORE INTO events SELECT * FROM events_staging`;
export const CLEAR_STAGING        = `DELETE FROM events_staging`;
export const COUNT_EVENTS_SQL     = `SELECT COUNT(*) AS c FROM events`;
