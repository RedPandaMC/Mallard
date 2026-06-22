/**
 * Watches Copilot and Claude Code log directories for new writes, debounces
 * re-parses, and appends new events to the EventStore.
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
import {
  findLogFiles,
  isPathSafe,
  isClaudeCodeLogFilename,
  locateCopilotLogDirs,
  locateClaudeCodeLogDirs,
  platformDefaults,
} from './locate';
import { ParseContext } from './otelParse';
import { LogParser } from './LogParser';
import { currentRepo } from './repoResolver';
import { activeBranch, repoForFolder, branchForFolder } from '../util/repo';
import { EventStore } from '../store/EventStore';
import { fileKeyOf } from './parsers/parserUtils';

const DEBOUNCE_MS = 1_500;

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
    private readonly parsers: readonly LogParser[],
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

  private async discoverFiles(): Promise<{ files: string[]; allowedRoots: string[] }> {
    const copilotDirs = await locateCopilotLogDirs(this.logUriPath, this.overridePath || undefined);
    const claudeDirs = await locateClaudeCodeLogDirs();
    const allowedRoots = [...new Set([...copilotDirs, ...claudeDirs])];
    const files: string[] = [];
    for (const dir of copilotDirs) {
      const found = await findLogFiles(dir, copilotDirs);
      files.push(...found);
    }
    for (const dir of claudeDirs) {
      const found = await findLogFiles(dir, claudeDirs, 5, 300, isClaudeCodeLogFilename);
      files.push(...found);
    }
    return { files, allowedRoots };
  }

  async start(): Promise<void> {
    const { files, allowedRoots } = await this.discoverFiles();
    this.allowedRoots = allowedRoots;
    this.searchedDirs = this.allCandidates();
    this.logPaths = files;

    if (files.length === 0) {
      this.status = { kind: 'empty', reason: 'No Copilot or Claude Code log files found' };
      return;
    }

    await this.loadOffsets();
    await this.parseAll(files);

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
    const { files, allowedRoots } = await this.discoverFiles();
    if (allowedRoots.length === 0) return;
    this.allowedRoots = allowedRoots;
    this.logPaths = files;
    await this.parseAll(files);
  }

  private async parseAll(files: string[]): Promise<void> {
    const globalRepo = currentRepo();
    const globalBranch = activeBranch();
    const baseCtx: ParseContext = {
      pricePerCredit: this.pricing.pricePerCredit,
      manifest: this.pricing.currentManifest,
      now: Date.now(),
      ...(globalRepo !== undefined ? { repo: globalRepo } : {}),
      ...(globalBranch !== undefined ? { branch: globalBranch } : {}),
    };

    let parseError = false;
    let changed = false;

    for (const file of files) {
      if (!isPathSafe(file, this.allowedRoots)) continue;

      const parser = this.parsers.find((p) => p.canParse(file));
      if (!parser) continue;

      try {
        const stat = await fs.stat(file);
        let offset = this.fileOffsets.get(file) ?? 0;
        if (stat.size < offset) offset = 0; // file rotated/truncated; re-read
        if (stat.size <= offset) continue; // nothing new

        const content = await fs.readFile(file, 'utf8');

        // Workspace-level attribution overrides the global active-editor context
        // when the parser can resolve the file to a specific workspace folder.
        const wf = parser.resolveWorkspace(file) as vscode.WorkspaceFolder | undefined;
        const fileRepo   = wf ? repoForFolder(wf)   : globalRepo;
        const fileBranch = wf ? branchForFolder(wf) : globalBranch;

        const fileCtx: ParseContext = {
          ...baseCtx,
          fileKey: fileKeyOf(file),
          baseOffset: offset,
          ...(fileRepo   !== undefined ? { repo:   fileRepo   } : {}),
          ...(fileBranch !== undefined ? { branch: fileBranch } : {}),
        };

        const events = parser.parse(content.slice(offset), fileCtx);
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
