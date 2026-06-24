import type { CostCategory, UsageEvent } from '../domain/types';

export type ConnectorStatus = 'idle' | 'ok' | 'empty' | 'error';

export interface ConnectorCapabilities {
  /** Token fields this connector can populate on a UsageEvent. */
  readonly tokenFields: ReadonlyArray<
    'promptTokens' | 'completionTokens' | 'cacheCreationTokens' | 'cacheReadTokens' | 'thinkingTokens'
  >;
  /** Cost categories this connector can produce. */
  readonly costCategories: ReadonlyArray<CostCategory>;
  /** Whether this connector can attribute events to a workspace repo. */
  readonly supportsRepoAttribution: boolean;
}

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
}

export type { UsageEvent };
