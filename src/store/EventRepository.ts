/**
 * Generic repository interface for the event store. Backed by DuckDB in
 * production; mock implementations are used in unit tests.
 *
 * Method names are intentionally non-domain-specific so the interface stays
 * stable as the schema and query patterns evolve.
 */
import type { Filter, SourceKind, UsageEvent } from '../domain/types';

// ── Query / filter ────────────────────────────────────────────────────────────

/**
 * Extends the shared domain Filter with store-level controls (branches, sources,
 * pagination) that the webview does not need to reason about.
 */
export interface RecordFilter extends Filter {
  branches?: string[];
  sources?: SourceKind[];
  limit?: number;
  offset?: number;
}

// ── Result types ──────────────────────────────────────────────────────────────

/**
 * Statistical aggregate over a set of numeric fields. All keys under each
 * sub-record match the field names passed to `aggregate()`.
 */
export interface AggregateResult {
  count: number;
  sum: Record<string, number>;
  mean: Record<string, number>;
  stddev: Record<string, number>;
  p50: Record<string, number>;
  p95: Record<string, number>;
  min: Record<string, number>;
  max: Record<string, number>;
}

/**
 * A single time-bucketed or categorical row.
 * `key` is the bucket label (ISO date, hour 0-23, weekday 0-6, model ID, …).
 * `values` carries the payload — keys match the numeric columns queried.
 */
export interface TimeBucket {
  key: string | number;
  values: Record<string, number>;
}

/** Result of a PIVOT / cross-tab query. */
export interface CrossTab {
  rows: Array<Record<string, string | number>>;
  columnKeys: string[];
}

/** Time resolution for bucket queries. */
export type BucketBy = 'hour' | 'day' | 'week' | 'month' | 'weekday';

// ── Interface ─────────────────────────────────────────────────────────────────

export interface EventRepository {
  // ── Writes ──────────────────────────────────────────────────────────────────

  /** Insert records; silently deduplicates by id. */
  insert(records: UsageEvent[]): Promise<number>;

  // ── Point reads ──────────────────────────────────────────────────────────────

  findById(id: string): Promise<UsageEvent | null>;
  find(filter?: RecordFilter): Promise<UsageEvent[]>;
  count(filter?: RecordFilter): Promise<number>;
  exists(id: string): Promise<boolean>;

  // ── Analytics ────────────────────────────────────────────────────────────────

  /**
   * Returns statistical aggregates (sum, mean, stddev, p50, p95, min, max) for
   * the requested numeric `fields` (e.g. `['credits', 'cost', 'tokens']`).
   */
  aggregate(filter: RecordFilter, fields: string[]): Promise<AggregateResult>;

  /**
   * Groups events into time buckets (hour-of-day, calendar day, weekday, …).
   * Each row has `key` = the bucket label and `values` = sum of credits/cost/tokens.
   */
  bucket(filter: RecordFilter, by: BucketBy): Promise<TimeBucket[]>;

  /**
   * PIVOT cross-tab: for every distinct value of `on` (e.g. `'surface'`) sums
   * the `value` column (e.g. `'credits'`) grouped by `modelId`.
   */
  pivot(filter: RecordFilter, on: string, value: string): Promise<CrossTab>;

  /**
   * Returns the top `limit` rows ranked by `by` field descending.
   * Useful for model / repo / surface leaderboards.
   */
  rank(filter: RecordFilter, by: string, limit?: number): Promise<TimeBucket[]>;

  // ── Meta key-value store ─────────────────────────────────────────────────────

  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;

  // ── Maintenance ───────────────────────────────────────────────────────────────

  /** Delete records matching the filter; returns the number removed. */
  remove(filter: RecordFilter): Promise<number>;

  /** Roll up events older than the raw window into daily aggregates. */
  compact(now?: number): Promise<void>;

  /** Return all events as a plain array (for report generation / export). */
  dump(): Promise<UsageEvent[]>;

  /** Wipe all events and metadata. */
  clear(): Promise<void>;

  // ── Future-facing stubs (reserved, not yet implemented) ──────────────────────
  // watch(filter: RecordFilter, cb: (e: UsageEvent) => void): vscode.Disposable;
  // upsert(records: UsageEvent[]): Promise<void>;
  // findBySession(sessionId: string): Promise<UsageEvent[]>;
}
