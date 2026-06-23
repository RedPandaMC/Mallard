/* c8 ignore start */
import * as vscode from 'vscode';
import { ProviderStatus } from '../domain/types';
import { platformDefaults } from './locate';
import type { LogConnector } from './LogConnector';
/* c8 ignore stop */

export class IngestService implements vscode.Disposable {
  constructor(private readonly connectors: readonly LogConnector[]) {}

  async start(): Promise<void> {
    await Promise.all(this.connectors.map((c) => c.start()));
  }

  getStatus(): ProviderStatus {
    const statuses = this.connectors.map((c) => c.getStatus());
    if (statuses.some((s) => s === 'ok')) {
      return { kind: 'ok', reason: `Tracking from ${this.connectors.length} connector(s)` };
    }
    if (statuses.some((s) => s === 'error')) {
      return { kind: 'degraded', reason: 'One or more connectors encountered errors' };
    }
    return { kind: 'empty', reason: 'No log files found' };
  }

  getLogPaths(): string[] {
    return this.connectors.flatMap((c) => c.getLogPaths());
  }

  getSearchedDirs(): string[] {
    return [...new Set(this.connectors.flatMap((c) => c.getSearchedDirs()))];
  }

  getKnownDirs(): string[] {
    return platformDefaults();
  }

  dispose(): void {
    this.connectors.forEach((c) => c.dispose());
  }
}
