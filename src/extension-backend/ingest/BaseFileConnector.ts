/* c8 ignore next */
import { currentRepo } from './repoResolver';
import { activeBranch } from '../util/repo';
import { activeLanguage } from '../util/editor';
import { ParseContext } from './otelParse';
import { PricingService } from '../pricing/PricingService';
import { DuckDBFileReader, RowMapper } from '../store/DuckDBFileReader';
import type { IMetaStore as MetaStore } from '../store/MetaStore';
import type { ConnectorStatus, DiscoverResult, LogConnector } from './LogConnector';
import type { SetupRequirement } from './SetupRequirement';
import type { UsageEvent } from '../domain/types';
import { IFsWatcher, NodeFsWatcher } from './IFsWatcher';
import { defaultLogger, Logger } from '../util/logger';

const DEBOUNCE_MS = 1_500;

/**
 * How far back an event timestamp may lag wall-clock and still count as
 * "live" (eligible for heuristic active-editor repo/branch attribution).
 * Guards against late-flushed old log lines being blamed on whatever repo is
 * focused right now.
 */
export const LIVE_WINDOW_MS = 5 * 60_000;

/** A discovered target is "empty" when it points at nothing on disk. */
function isEmptyTarget(t: DiscoverResult): boolean {
  return 'kind' in t ? !t.dbPath : t.globs.length === 0;
}

export abstract class BaseFileConnector implements LogConnector {
  abstract readonly id: string;
  abstract readonly displayName: string;

  /** Discover the ingest target (NDJSON globs or a SQLite DB) for this connector. */
  protected abstract discover(): Promise<DiscoverResult>;

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
  private currentTarget?: DiscoverResult;
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
    const target = await this.discover();
    this.searchedDirs_ = target.searchedDirs;
    if (isEmptyTarget(target)) {
      this.status = 'empty';
      return;
    }
    this.currentTarget = target;
    this.status = 'loading';
    await this.runIngest(target);
    this.watchDirs(target.allowedRoots);
  }

  /**
   * Run one ingest pass, coalescing concurrent triggers: while a pass is in
   * flight (initial start, watcher debounce, and interval refresh can all
   * overlap), later triggers queue exactly one re-run instead of racing the
   * shared watermark.
   */
  protected async runIngest(target: DiscoverResult): Promise<void> {
    if (this.ingestRunning) {
      this.rerunQueued = true;
      return;
    }
    this.ingestRunning = true;
    try {
      do {
        this.rerunQueued = false;
        await this.ingestOnce(target);
      } while (this.rerunQueued);
    } finally {
      this.ingestRunning = false;
    }
  }

  private async ingestOnce(target: DiscoverResult): Promise<void> {
    const sinceMs = await this.loadWatermark();
    const globs = 'kind' in target ? [] : target.globs;
    const ctx = await this.buildContext(globs, sinceMs);
    try {
      const mapRow = this.mapRow.bind(this) as RowMapper;
      const { inserted, maxEventTs } =
        'kind' in target
          ? await this.fileReader.ingestSqlite(target.dbPath, target.query, mapRow, ctx)
          : await this.fileReader.ingestGlob(target.globs, mapRow, ctx, sinceMs ?? undefined);
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
  protected async buildContext(_globs: string[], watermarkMs: number | null = null): Promise<ParseContext> {
    const repo = currentRepo();
    const branch = activeBranch();
    const language = activeLanguage();
    const tokenPrices = this.pricing.tokenPrices;
    const now = Date.now();
    // Liveness rule: heuristic attribution only applies once this connector
    // has a watermark (steady state — a fresh DB or post-clear re-ingest is a
    // backfill even when timestamps are recent) AND the row's ts falls inside
    // the recent window. Without a watermark liveThresholdMs stays unset and
    // no row is live.
    const liveThresholdMs = watermarkMs !== null ? now - LIVE_WINDOW_MS : undefined;
    return {
      pricePerCredit: this.pricing.pricePerCredit,
      manifest: this.pricing.currentManifest,
      ...(tokenPrices !== undefined ? { tokenPrices } : {}),
      now,
      /* c8 ignore next */
      ...(repo !== undefined ? { repo } : {}),
      /* c8 ignore next */
      ...(branch !== undefined ? { branch } : {}),
      ...(language !== undefined ? { language } : {}),
      ...(liveThresholdMs !== undefined ? { liveThresholdMs } : {}),
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
    const target = this.currentTarget;
    if (!target) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.runIngest(target), DEBOUNCE_MS);
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
  /** No external prerequisites by default; connectors override to declare them. */
  getSetupRequirements(): SetupRequirement[] { return []; }
  /* c8 ignore next */
}
