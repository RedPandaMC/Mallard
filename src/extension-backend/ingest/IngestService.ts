import * as vscode from 'vscode';
import { ProviderStatus } from '../domain/types';
import { platformDefaults } from './locate';
import type { LogConnector } from './LogConnector';

export class IngestService implements vscode.Disposable {
  constructor(private readonly connectors: readonly LogConnector[]) {}

  async start(): Promise<void> {
    await Promise.all(this.connectors.map((c) => c.start()));
  }

  getStatus(): ProviderStatus {
    const statuses = this.connectors.map((c) => ({ id: c.id, status: c.getStatus() }));
    if (statuses.some((s) => s.status === 'loading')) {
      return { kind: 'loading', reason: 'Reading log files…' };
    }
    // A failing connector must surface as degraded even when another connector
    // is healthy — otherwise a broken source is silently masked by a working
    // one and the user never learns half their data is missing.
    const errored = statuses.filter((s) => s.status === 'error');
    if (errored.length > 0) {
      const ids = errored.map((s) => s.id).join(', ');
      return { kind: 'degraded', reason: `Connector error: ${ids}` };
    }
    if (statuses.some((s) => s.status === 'ok')) {
      return { kind: 'ok', reason: `Tracking from ${this.connectors.length} connector(s)` };
    }
    return { kind: 'empty', reason: 'No log files found' };
  }

  getLogPaths(): string[] {
    return this.connectors.flatMap((c) => c.getLogPaths());
  }

  getConnectorLogPaths(connectorId: string): string[] {
    return this.connectors.find((c) => c.id === connectorId)?.getLogPaths() ?? [];
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
