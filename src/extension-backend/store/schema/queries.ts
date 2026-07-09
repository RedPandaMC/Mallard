// ── Queries: events ───────────────────────────────────────────────────────────

export const FIND_ALL_SQL    = `SELECT * FROM events ORDER BY ts`;
export const FIND_BY_ID_SQL  = `SELECT * FROM events WHERE id = ?`;
export const COUNT_ALL_SQL   = `SELECT COUNT(*) AS c FROM events`;

// ── Queries: branch credits ───────────────────────────────────────────────────

export const CREDITS_BY_BRANCH_SQL = `SELECT COALESCE(SUM(credits), 0) AS c FROM events WHERE branch = ?`;

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
