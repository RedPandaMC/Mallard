import type { UsageEvent } from '../domain/types';

export type ConnectorStatus = 'idle' | 'ok' | 'empty' | 'error';

export interface LogConnector {
  readonly id: string;
  readonly displayName: string;
  /** Begin ingestion. Resolves once the initial parse is complete. */
  start(): Promise<void>;
  dispose(): void;
  getStatus(): ConnectorStatus;
  getLogPaths(): string[];
  getSearchedDirs(): string[];
}

export type { UsageEvent };
