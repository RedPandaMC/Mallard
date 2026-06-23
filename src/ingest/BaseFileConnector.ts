/* c8 ignore start */
import { watch as fsWatch, FSWatcher } from 'fs';
import { currentRepo } from './repoResolver';
import { activeBranch } from '../util/repo';
import { ParseContext } from './otelParse';
import { PricingService } from '../pricing/PricingService';
import { DuckDBFileReader, RowMapper } from '../store/DuckDBFileReader';
import type { MetaStore } from '../store/MetaStore';
import type { ConnectorStatus, LogConnector } from './LogConnector';
import type { UsageEvent } from '../domain/types';
/* c8 ignore stop */

const DEBOUNCE_MS = 1_500;

export abstract class BaseFileConnector implements LogConnector {
  abstract readonly id: string;
  abstract readonly displayName: string;

  /** MetaStore key for this connector's timestamp watermark. */
  protected abstract get watermarkKey(): string;

  /** Discover globs and allowed root dirs for this connector. */
  protected abstract discover(): Promise<{
    globs: string[];
    allowedRoots: string[];
    searchedDirs: string[];
  }>;

  /** Map one raw DuckDB row to a UsageEvent, or null to skip. */
  protected abstract mapRow(row: Record<string, unknown>, ctx: ParseContext): UsageEvent | null;

  protected logPaths: string[] = [];
  protected searchedDirs_: string[] = [];

  private status: ConnectorStatus = 'idle';
  private eventsSeenEver = false;
  private watchers: FSWatcher[] = [];
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private currentGlobs: string[] = [];

  constructor(
    protected readonly pricing: PricingService,
    protected readonly meta: MetaStore,
    protected readonly fileReader: DuckDBFileReader,
  ) {}

  async start(): Promise<void> {
    const { globs, allowedRoots, searchedDirs } = await this.discover();
    this.searchedDirs_ = searchedDirs;
    if (globs.length === 0) {
      this.status = 'empty';
      return;
    }
    this.currentGlobs = globs;
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
      console.warn(`[mallard] ${this.id}: ingest error`, err);
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
        this.watchers.push(
          fsWatch(dir, { recursive: false }, () => this.scheduleReparse()),
        );
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
    /* c8 ignore next */
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    for (const w of this.watchers) {
      /* c8 ignore next */
      try { w.close(); } catch { /* ignore */ }
    }
    this.watchers = [];
  }

  getStatus(): ConnectorStatus { return this.status; }
  getLogPaths(): string[] { return this.logPaths.slice(); }
  getSearchedDirs(): string[] { return this.searchedDirs_.slice(); }
/* c8 ignore next */
}
