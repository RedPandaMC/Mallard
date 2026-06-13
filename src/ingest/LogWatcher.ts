/**
 * Watches Copilot log directories for new writes, debounces re-parses,
 * and appends new events to the EventStore.
 *
 * Lifecycle:
 *   1. start()  — full initial parse of all discovered log files
 *   2. fs.watch — debounced incremental re-parse on change events
 *   3. dispose() — stop watching, release resources
 */
import { promises as fs, watch as fsWatch, FSWatcher } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProviderStatus } from '../domain/types';
import { PricingService } from '../pricing/PricingService';
import { findLogFiles, isPathSafe, locateCopilotLogDirs } from './locate';
import { parseOtelContent } from './otelParse';
import { EventStore } from '../store/EventStore';

const DEBOUNCE_MS = 1_500;

export class LogWatcher implements vscode.Disposable {
  private watchers: FSWatcher[] = [];
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private status: ProviderStatus = { kind: 'empty' };
  private logPaths: string[] = [];
  private allowedRoots: string[] = [];
  private fileOffsets = new Map<string, number>();

  constructor(
    private readonly store: EventStore,
    private readonly pricing: PricingService,
    private readonly logUriPath?: string,
    private readonly overridePath?: string,
  ) {}

  getStatus(): ProviderStatus {
    return this.status;
  }

  getLogPaths(): string[] {
    return this.logPaths.slice();
  }

  async start(): Promise<void> {
    const dirs = await locateCopilotLogDirs(this.logUriPath, this.overridePath || undefined);
    this.allowedRoots = dirs;

    const files: string[] = [];
    for (const dir of dirs) {
      const found = await findLogFiles(dir, dirs);
      files.push(...found);
    }

    this.logPaths = files;

    if (files.length === 0) {
      this.status = { kind: 'empty', reason: 'No Copilot log files found' };
      return;
    }

    // Full initial parse.
    await this.parseAll(files, true);

    // Watch each log directory (not individual files — Copilot rotates logs).
    const watchedDirs = new Set(files.map((f) => path.dirname(f)));
    for (const dir of watchedDirs) {
      try {
        const w = fsWatch(dir, { recursive: false }, () => this.scheduleReparse());
        this.watchers.push(w);
      } catch {
        // Watch unavailable in some environments — fall back to interval polling in UsageService.
      }
    }
  }

  private scheduleReparse(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.reparse(), DEBOUNCE_MS);
  }

  private async reparse(): Promise<void> {
    // Re-discover files (Copilot may have created new log files).
    const dirs = await locateCopilotLogDirs(this.logUriPath, this.overridePath || undefined);
    if (dirs.length === 0) return;
    this.allowedRoots = dirs;
    const files: string[] = [];
    for (const dir of dirs) {
      const found = await findLogFiles(dir, dirs);
      files.push(...found);
    }
    this.logPaths = files;
    await this.parseAll(files, false);
  }

  private async parseAll(files: string[], full: boolean): Promise<void> {
    const ctx = {
      pricePerCredit: this.pricing.pricePerCredit,
      manifest: this.pricing.currentManifest,
      now: Date.now(),
    };

    let totalAdded = 0;
    let parseError = false;

    for (const file of files) {
      if (!isPathSafe(file, this.allowedRoots)) continue;
      try {
        const stat = await fs.stat(file);
        const offset = full ? 0 : (this.fileOffsets.get(file) ?? 0);
        if (!full && stat.size <= offset) continue;

        const content = await fs.readFile(file, 'utf8');
        const events = parseOtelContent(
          full ? content : content.slice(offset),
          ctx,
        );
        if (events.length > 0) {
          const added = await this.store.append(events);
          totalAdded += added;
        }
        this.fileOffsets.set(file, stat.size);
      } catch {
        parseError = true;
      }
    }

    const total = this.store.count();
    if (total > 0) {
      this.status = { kind: 'ok', reason: `Tracking from ${files.length} log file(s)` };
    } else if (parseError) {
      this.status = { kind: 'degraded', reason: 'Log files found but could not be parsed' };
    } else {
      this.status = { kind: 'empty', reason: 'Log files found but no usage events yet' };
    }

    void totalAdded; // suppress unused warning — side effects are in the store
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    for (const w of this.watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    this.watchers = [];
  }
}
