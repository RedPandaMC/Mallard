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
