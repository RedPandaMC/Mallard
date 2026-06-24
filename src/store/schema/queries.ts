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
