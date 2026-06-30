// ── DML: snapshot cache refresh ───────────────────────────────────────────────

export function buildRefreshSnapSQL(retentionDays: number): string {
  return `
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
    WHERE to_timestamp(ts/1000.0)::TIMESTAMPTZ >= date_trunc('day', now()::TIMESTAMPTZ) - INTERVAL '${retentionDays} days'
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
    WITH sums AS (
      SELECT
        SUM(cost_input)       AS c_input,
        SUM(cost_output)      AS c_output,
        SUM(cost_cache_read)  AS c_cache_read,
        SUM(cost_cache_write) AS c_cache_creation,
        SUM(cost_thinking)    AS c_thinking,
        SUM(cost_tool)        AS c_tool
      FROM v_events
    )
    SELECT cat, val FROM (
      SELECT 'input'         AS cat, c_input         AS val FROM sums
      UNION ALL SELECT 'output',          c_output         FROM sums
      UNION ALL SELECT 'cache_read',      c_cache_read     FROM sums
      UNION ALL SELECT 'cache_creation',  c_cache_creation FROM sums
      UNION ALL SELECT 'thinking',        c_thinking       FROM sums
      UNION ALL SELECT 'tool',            c_tool           FROM sums
    ) WHERE val > 0;

  DELETE FROM snap_sankey;
  INSERT INTO snap_sankey (model, surface, count, credits)
    SELECT modelId, surface, COUNT(*), COALESCE(SUM(credits), 0)
    FROM events
    GROUP BY modelId, surface;

  DELETE FROM snap_weekday;
  INSERT INTO snap_weekday (weekday, credits, event_count)
    SELECT weekday, COALESCE(SUM(credits), 0), CAST(SUM(event_count) AS INTEGER)
    FROM v_usage_by_weekday
    GROUP BY weekday
    ORDER BY weekday;

  DELETE FROM snap_dim_models;   INSERT INTO snap_dim_models   (name) SELECT DISTINCT modelId FROM events;
  DELETE FROM snap_dim_surfaces; INSERT INTO snap_dim_surfaces (name) SELECT DISTINCT surface FROM events;
  DELETE FROM snap_dim_sources;  INSERT INTO snap_dim_sources  (name) SELECT DISTINCT source  FROM events;
  DELETE FROM snap_dim_repos;    INSERT INTO snap_dim_repos    (name) SELECT DISTINCT COALESCE(repo, 'unattributed') FROM events;
`;
}

export const REFRESH_SNAP_SQL = buildRefreshSnapSQL(90);
