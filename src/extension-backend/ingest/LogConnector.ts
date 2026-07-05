import type { CostCategory, UsageEvent } from '../domain/types';
import type { SetupRequirement } from './SetupRequirement';

export type ConnectorStatus = 'idle' | 'loading' | 'ok' | 'empty' | 'error';

/** Ingest source kinds a connector can read from. */
export type SourceKind = 'ndjson' | 'sqlite';

export interface ConnectorCapabilities {
  /** Token fields this connector can populate on a UsageEvent. */
  readonly tokenFields: ReadonlyArray<
    'promptTokens' | 'completionTokens' | 'cacheCreationTokens' | 'cacheReadTokens' | 'thinkingTokens'
  >;
  /** Cost categories this connector can produce. */
  readonly costCategories: ReadonlyArray<CostCategory>;
  /** Whether this connector can attribute events to a workspace repo. */
  readonly supportsRepoAttribution: boolean;
  /** Ingest source kinds this connector reads from (NDJSON files, SQLite DBs). */
  readonly sources: ReadonlyArray<SourceKind>;
}

/**
 * What a connector's `discover()` resolves to. The `ndjson` variant keeps
 * `globs` at the top level (back-compat); the `sqlite` variant carries a DB
 * path + query. Both share `allowedRoots`/`searchedDirs`. An empty result
 * (no globs / no dbPath) marks the connector as `empty`.
 */
export type DiscoverResult =
  | { globs: string[]; allowedRoots: string[]; searchedDirs: string[] }
  | { kind: 'sqlite'; dbPath: string; query: string; allowedRoots: string[]; searchedDirs: string[] };

export interface LogConnector {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ConnectorCapabilities;
  /** Begin ingestion. Resolves once the initial parse is complete. */
  start(): Promise<void>;
  dispose(): void;
  getStatus(): ConnectorStatus;
  getLogPaths(): string[];
  getSearchedDirs(): string[];
  /** External prerequisites this connector needs to produce data (default none). */
  getSetupRequirements(): SetupRequirement[];
}

export type { UsageEvent };
