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

  protected async runIngest(globs: string[]): Promise<void> {
    const sinceMs = await this.loadWatermark();
    const ctx = await this.buildContext(globs);
    try {
      const inserted = await this.fileReader.ingestGlob(
        globs,
        this.mapRow.bind(this) as RowMapper,
        ctx,
        sinceMs ?? undefined,
      );
      if (inserted > 0) {
        this.eventsSeenEver = true;
        await this.saveWatermark(Date.now());
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
    return {
      pricePerCredit: this.pricing.pricePerCredit,
      manifest: this.pricing.currentManifest,
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
      try {
        this.watchers.push(this.fsWatcher.watch(dir, () => this.scheduleReparse()));
      } catch {
        // fs.watch unavailable — fall back to UsageService interval polling.
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
