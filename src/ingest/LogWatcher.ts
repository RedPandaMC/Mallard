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
import { findLogFiles, isPathSafe, locateCopilotLogDirs, platformDefaults } from './locate';
import { parseOtelContent, ParseContext } from './otelParse';
import { currentRepo } from './repoResolver';
import { activeBranch } from '../util/repo';
import { EventStore } from '../store/EventStore';

const DEBOUNCE_MS = 1_500;

/** Short, stable key for a file path (djb2) used to namespace event ids. */
function fileKeyOf(filePath: string): string {
  let hash = 5381;
  for (let i = 0; i < filePath.length; i++) hash = ((hash << 5) + hash + filePath.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export class LogWatcher implements vscode.Disposable {
  private watchers: FSWatcher[] = [];
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private status: ProviderStatus = { kind: 'empty' };
  private logPaths: string[] = [];
  private allowedRoots: string[] = [];
  private searchedDirs: string[] = [];
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

  /** Candidate directories the watcher looked at on its last start/reparse. */
  getSearchedDirs(): string[] {
    return this.searchedDirs.slice();
  }

  /** All platform-default log roots we know about (for diagnostics). */
  getKnownDirs(): string[] {
    return platformDefaults();
  }

  /** Union of override + VS Code log root + platform defaults (deduped, in order). */
  private allCandidates(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (p: string | undefined) => {
      if (!p) return;
      const key = path.resolve(p);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(key);
    };
    push(this.overridePath);
    if (this.logUriPath) {
      // mirror locateCopilotLogDirs's logic for the session root
      const root = (() => {
        let pathToWalk = this.logUriPath!;
        for (let i = 0; i < 4; i++) {
          const parent = path.dirname(pathToWalk);
          if (parent === pathToWalk) break;
          if (path.basename(parent).toLowerCase() === 'logs') return parent;
          pathToWalk = parent;
        }
        return path.dirname(this.logUriPath!);
      })();
      push(root);
    }
    for (const d of platformDefaults()) push(d);
    return out;
  }

  async start(): Promise<void> {
    const dirs = await locateCopilotLogDirs(this.logUriPath, this.overridePath || undefined);
    this.allowedRoots = dirs;
    this.searchedDirs = this.allCandidates();

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

    // Resume from persisted read offsets so startup only parses new log bytes.
    await this.loadOffsets();
    await this.parseAll(files);

    // Watch each log directory (not individual files — Copilot rotates logs).
    const watchedDirs = new Set(files.map((f) => path.dirname(f)));
    for (const dir of watchedDirs) {
      try {
        const watcher = fsWatch(dir, { recursive: false }, () => this.scheduleReparse());
        this.watchers.push(watcher);
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
    await this.parseAll(files);
  }

  private async parseAll(files: string[]): Promise<void> {
    const repo = currentRepo();
    const branch = activeBranch();
    const baseCtx: ParseContext = {
      pricePerCredit: this.pricing.pricePerCredit,
      manifest: this.pricing.currentManifest,
      now: Date.now(),
      ...(repo !== undefined ? { repo } : {}),
      ...(branch !== undefined ? { branch } : {}),
    };

    let parseError = false;
    let changed = false;

    for (const file of files) {
      if (!isPathSafe(file, this.allowedRoots)) continue;
      try {
        const stat = await fs.stat(file);
        let offset = this.fileOffsets.get(file) ?? 0;
        if (stat.size < offset) offset = 0; // file was rotated/truncated; re-read
        if (stat.size <= offset) continue; // nothing new

        const content = await fs.readFile(file, 'utf8');
        // Per-line offsets keyed by file make event ids stable across full and
        // incremental re-parses, so INSERT OR IGNORE dedups instead of
        // re-inserting the same event under a new id.
        const events = parseOtelContent(content.slice(offset), {
          ...baseCtx,
          fileKey: fileKeyOf(file),
          baseOffset: offset,
        });
        if (events.length > 0) await this.store.append(events);
        this.fileOffsets.set(file, stat.size);
        changed = true;
      } catch (err) {
        console.warn('[mallard] LogWatcher: error parsing', file, err);
        parseError = true;
      }
    }

    if (changed) {
      await this.saveOffsets();
      for (const filePath of this.fileOffsets.keys())
        if (!this.logPaths.includes(filePath)) this.fileOffsets.delete(filePath);
    }

    const total = await this.store.count();
    if (total > 0) {
      this.status = { kind: 'ok', reason: `Tracking from ${files.length} log file(s)` };
    } else if (parseError) {
      this.status = { kind: 'degraded', reason: 'Log files found but could not be parsed' };
    } else {
      this.status = { kind: 'empty', reason: 'Log files found but no usage events yet' };
    }
  }

  /** Restore persisted per-file read offsets so a restart resumes incrementally. */
  private async loadOffsets(): Promise<void> {
    try {
      const raw = await this.store.getMeta('fileOffsets');
      this.fileOffsets = raw ? new Map(JSON.parse(raw) as [string, number][]) : new Map();
    } catch (err) {
      console.warn('[mallard] LogWatcher: failed to load file offsets, starting fresh', err);
      this.fileOffsets = new Map();
    }
  }

  private async saveOffsets(): Promise<void> {
    try {
      await this.store.setMeta('fileOffsets', JSON.stringify([...this.fileOffsets]));
    } catch {
      /* best-effort */
    }
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    this.watchers = [];
  }
}
