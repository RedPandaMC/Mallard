/**
 * Orchestrates capture sources → EventStore → UsageSnapshot, and emits one
 * `onDidChangeSnapshot` stream that the status bar, dashboard, sidebar and
 * notifier all subscribe to.
 *
 * Real events (captured @weevil usage, parsed local logs) are persisted to the
 * store. Sample data is ephemeral — used for display only, never persisted, so
 * it can't accumulate or double-count.
 */
import * as vscode from 'vscode';
import { readConfig } from '../config';
import { buildSnapshot, SnapshotOptions } from '../model/snapshot';
import { Filter, ProviderStatus, SourceKind, UsageEvent, UsageSnapshot } from '../model/types';
import { activeAttribution } from '../util/repo';
import { DAY_MS, startOf } from '../util/time';
import { GitHubBillingProvider } from './providers/GitHubBillingProvider';
import { LocalLogProvider } from './providers/LocalLogProvider';
import { SampleProvider } from './providers/SampleProvider';
import { EventStore } from './store/EventStore';
import { ProviderContext } from './UsageProvider';

export class UsageService implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<UsageSnapshot>();
  readonly onDidChangeSnapshot = this._onDidChange.event;

  private snapshot?: UsageSnapshot;
  private lastEvents: UsageEvent[] = [];
  private filter: Filter = {};
  private timer?: ReturnType<typeof setInterval>;
  private refreshing?: Promise<void>;
  private readonly sessionStart = Date.now();

  private ingestStatus: ProviderStatus = { kind: 'ok' };
  private readonly sample = new SampleProvider();
  private readonly local = new LocalLogProvider();
  private readonly github: GitHubBillingProvider;

  constructor(
    private readonly store: EventStore,
    getToken: () => Promise<string | undefined>,
  ) {
    this.github = new GitHubBillingProvider(getToken);
  }

  get current(): UsageSnapshot | undefined {
    return this.snapshot;
  }

  /** Events the latest snapshot was built from (real store data or sample fallback). */
  get events(): readonly UsageEvent[] {
    return this.lastEvents;
  }

  getFilter(): Filter {
    return this.filter;
  }

  async setFilter(filter: Filter): Promise<void> {
    this.filter = filter;
    await this.compute();
  }

  async start(): Promise<void> {
    await this.store.load();
    await this.refresh();
    this.scheduleTimer();
  }

  onConfigChanged(): void {
    this.scheduleTimer();
    void this.refresh();
  }

  /** Persist captured/parsed events and recompute. */
  async record(events: UsageEvent[]): Promise<void> {
    await this.store.append(events);
    await this.compute();
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private buildContext(now: number): ProviderContext {
    const cfg = readConfig();
    return {
      pricePerCredit: cfg.pricePerCredit,
      currency: cfg.currency,
      modelMultipliers: cfg.modelMultipliers,
      copilotLogPath: cfg.copilotLogPath,
      now,
    };
  }

  private async doRefresh(): Promise<void> {
    const cfg = readConfig();
    const now = Date.now();
    const ctx = this.buildContext(now);
    const range = { start: startOf(now - 365 * DAY_MS, 'day'), end: now + 1 };

    // Ingest real signals (never sample) into the persistent store.
    if (cfg.dataSource !== 'sample') {
      const local = await this.local.fetch(range, ctx);
      this.ingestStatus = local.status;
      if (local.events.length) await this.store.append(local.events);
    }

    // Calibration hook (stub today; never throws, never the sole source).
    await this.github.fetch(range, ctx);

    await this.compute();
  }

  /** Rebuild the snapshot from the store (+ ephemeral sample fallback) and emit. */
  private async compute(): Promise<void> {
    const cfg = readConfig();
    const now = Date.now();
    const ctx = this.buildContext(now);

    const real = this.store.query();
    const useSample =
      cfg.dataSource === 'sample' || (cfg.dataSource === 'auto' && real.length === 0);

    let events: UsageEvent[];
    let source: SourceKind;
    let status: ProviderStatus;

    if (useSample) {
      const range = { start: startOf(now - 365 * DAY_MS, 'day'), end: now + 1 };
      const result = await this.sample.fetch(range, ctx);
      events = result.events;
      source = 'sample';
      status = result.status;
    } else {
      events = real;
      source = real.some((e) => e.source === 'local') ? 'local' : 'lm';
      status =
        real.length === 0
          ? this.ingestStatus
          : { kind: 'ok', reason: 'Tracking your Copilot usage' };
    }

    const attribution = activeAttribution();
    const options: SnapshotOptions = {
      now,
      currency: cfg.currency,
      pricePerCredit: cfg.pricePerCredit,
      monthlyBudget: cfg.monthlyBudget > 0 ? cfg.monthlyBudget : null,
      includedCredits: cfg.includedCredits,
      filter: this.filter,
      source,
      status,
      statusBarScope: cfg.statusBarScope,
      activeRepo: attribution.repo,
      activeWorkspace: attribution.workspaceFolder,
      sessionStart: this.sessionStart,
    };

    this.lastEvents = events;
    this.snapshot = buildSnapshot(events, options);
    this._onDidChange.fire(this.snapshot);
  }

  private scheduleTimer(): void {
    const cfg = readConfig();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(
      () => void this.refresh(),
      Math.max(1, cfg.refreshIntervalMinutes) * 60_000,
    );
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this._onDidChange.dispose();
  }
}
