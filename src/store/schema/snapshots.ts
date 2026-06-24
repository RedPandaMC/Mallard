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
