/* c8 ignore next */
import { currentRepo } from './repoResolver';
import { activeBranch } from '../util/repo';
import { ParseContext } from './otelParse';
import { PricingService } from '../pricing/PricingService';
import { DuckDBFileReader, RowMapper } from '../store/DuckDBFileReader';
import type { IMetaStore as MetaStore } from '../store/MetaStore';
import type { ConnectorStatus, LogConnector } from './LogConnector';
import type { UsageEvent } from '../domain/types';
import { IFsWatcher, NodeFsWatcher } from './IFsWatcher';
import { defaultLogger, Logger } from '../util/logger';

const DEBOUNCE_MS = 1_500;

export abstract class BaseFileConnector implements LogConnector {
  abstract readonly id: string;
  abstract readonly displayName: string;

  /** Discover globs and allowed root dirs for this connector. */
  protected abstract discover(): Promise<{
    globs: string[];
    allowedRoots: string[];
    searchedDirs: string[];
  }>;

  /** Map one raw DuckDB row to a UsageEvent, or null to skip. */
  protected abstract mapRow(row: Record<string, unknown>, ctx: ParseContext): UsageEvent | null;

  /** MetaStore key for this connector's timestamp watermark. Derived from id by default. */
  protected get watermarkKey(): string {
    return `${this.id}:watermark`;
  }

  protected logPaths: string[] = [];
  protected searchedDirs_: string[] = [];

  private status: ConnectorStatus = 'idle';
  private eventsSeenEver = false;
  private watchers: Array<{ close(): void }> = [];
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private currentGlobs: string[] = [];
  private ingestRunning = false;
  private rerunQueued = false;

  constructor(
    protected readonly pricing: PricingService,
    protected readonly meta: MetaStore,
    protected readonly fileReader: DuckDBFileReader,
    private readonly fsWatcher: IFsWatcher = new NodeFsWatcher(),
    protected readonly logger: Logger = defaultLogger,
  ) {}

  async start(): Promise<void> {
    const { globs, allowedRoots, searchedDirs } = await this.discover();
    this.searchedDirs_ = searchedDirs;
    if (globs.length === 0) {
      this.status = 'empty';
      return;
    }
    this.currentGlobs = globs;
    this.status = 'loading';
    await this.runIngest(globs);
    this.watchDirs(allowedRoots);
  }

  /**
   * Run one ingest pass, coalescing concurrent triggers: while a pass is in
   * flight (initial start, watcher debounce, and interval refresh can all
   * overlap), later triggers queue exactly one re-run instead of racing the
   * shared watermark.
   */
  protected async runIngest(globs: string[]): Promise<void> {
    if (this.ingestRunning) {
      this.rerunQueued = true;
      return;
    }
    this.ingestRunning = true;
    try {
      do {
        this.rerunQueued = false;
        await this.ingestOnce(globs);
      } while (this.rerunQueued);
    } finally {
      this.ingestRunning = false;
    }
  }

  private async ingestOnce(globs: string[]): Promise<void> {
    const sinceMs = await this.loadWatermark();
    const ctx = await this.buildContext(globs);
    try {
      const { inserted, maxEventTs } = await this.fileReader.ingestGlob(
        globs,
        this.mapRow.bind(this) as RowMapper,
        ctx,
        sinceMs ?? undefined,
      );
      if (inserted > 0) {
        this.eventsSeenEver = true;
        // Advance the watermark to the newest *event* timestamp, not the wall
        // clock: log lines flushed late with older embedded timestamps would
        // otherwise be skipped forever. Re-reads of already-seen rows are
        // idempotent (INSERT OR IGNORE on deterministic ids).
        if (maxEventTs !== null) await this.saveWatermark(maxEventTs);
      }
      this.status = this.eventsSeenEver ? 'ok' : 'empty';
    } catch (err) {
      this.logger.warn(this.id, 'ingest error', err);
      this.status = 'error';
    }
  }

  /**
   * Build the ParseContext for an ingest run. Subclasses may override to add
   * connector-specific fields (e.g. surface detection for Claude Code).
   */
  protected async buildContext(_globs: string[]): Promise<ParseContext> {
    const repo = currentRepo();
    const branch = activeBranch();
    const tokenPrices = this.pricing.tokenPrices;
    return {
      pricePerCredit: this.pricing.pricePerCredit,
      manifest: this.pricing.currentManifest,
      ...(tokenPrices !== undefined ? { tokenPrices } : {}),
      now: Date.now(),
      /* c8 ignore next */
      ...(repo !== undefined ? { repo } : {}),
      /* c8 ignore next */
      ...(branch !== undefined ? { branch } : {}),
    };
  }

  private watchDirs(roots: string[]): void {
    const dirs = new Set(roots);
    for (const dir of dirs) {
      // Recursive: session files live in nested subdirectories (Claude Code
      // writes projects/<workspace>/<session>.jsonl, Copilot logs are per-window
      // trees) and non-recursive fs.watch on the root misses writes inside them.
      try {
        this.watchers.push(this.fsWatcher.watch(dir, () => this.scheduleReparse(), true));
        continue;
      } catch (err) {
        this.logger.debug(this.id, `recursive fs.watch failed for ${dir}, retrying flat`, err);
      }
      try {
        this.watchers.push(this.fsWatcher.watch(dir, () => this.scheduleReparse(), false));
      } catch (err) {
        // fs.watch unavailable — fall back to UsageService interval polling.
        this.logger.debug(this.id, `fs.watch unavailable for ${dir}; relying on interval polling`, err);
      }
    }
  }

  private scheduleReparse(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(
      () => void this.runIngest(this.currentGlobs),
      DEBOUNCE_MS,
    );
  }

  private async loadWatermark(): Promise<number | null> {
    const raw = await this.meta.get(this.watermarkKey);
    return raw ? Number(raw) : null;
  }

  private async saveWatermark(ms: number): Promise<void> {
    await this.meta.set(this.watermarkKey, String(ms));
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    for (const w of this.watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    this.watchers = [];
  }

  abstract readonly capabilities: import('./LogConnector').ConnectorCapabilities;

  getStatus(): ConnectorStatus { return this.status; }
  getLogPaths(): string[] { return this.logPaths.slice(); }
  getSearchedDirs(): string[] { return this.searchedDirs_.slice(); }
  /* c8 ignore next */
}
