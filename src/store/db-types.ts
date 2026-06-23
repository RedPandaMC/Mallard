/** Kysely table-shape definitions for every DuckDB table in the event store. */

export interface EventsTable {
  id: string;
  ts: number | bigint;
  modelId: string;
  surface: string;
  source: string;
  credits: number;
  cost: number;
  promptTokens: number | null;
  completionTokens: number | null;
  estimated: boolean;
  repo: string | null;
  costByCategory: string | null;
  branch: string | null;
}

export interface MetaTable {
  key: string;
  value: string;
}

export interface PricesTable {
  modelId: string;
  multiplier: number;
}

export interface DimSurfaceTable {
  id: number;
  name: string;
}

export interface DimSourceTable {
  id: number;
  name: string;
}

export interface DimModelTable {
  id: number;
  name: string;
}

export interface DimRepoTable {
  id: number;
  name: string;
}

export interface DimDateTable {
  id: number;
  date: string;
  year: number;
  month: number;
  week: number;
  day_of_week: number;
}

export interface FactDailyUsageTable {
  date_id: number;
  model_id: number;
  surface_id: number;
  source_id: number;
  repo_id: number;
  credits: number;
  cost: number;
  tokens: number | bigint;
  event_count: number;
  cost_input: number;
  cost_output: number;
  cost_cache_read: number;
  cost_cache_write: number;
  cost_thinking: number;
  cost_tool: number;
}

export interface Database {
  events: EventsTable;
  meta: MetaTable;
  prices: PricesTable;
  dim_surface: DimSurfaceTable;
  dim_source: DimSourceTable;
  dim_model: DimModelTable;
  dim_repo: DimRepoTable;
  dim_date: DimDateTable;
  fact_daily_usage: FactDailyUsageTable;
}
