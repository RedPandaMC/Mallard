/**
 * Orchestrates LogWatcher → EventStore → UsageSnapshot and emits one
 * `onDidChangeSnapshot` stream that the status bar, dashboard, and sidebar
 * all subscribe to.
 */
import * as vscode from 'vscode';
import { matchesFilter } from '../domain/aggregate';
import { evaluateAlerts, SnapshotSample } from '../domain/alerts';
import { buildSnapshot, SnapshotOptions } from '../domain/snapshot';
import { AuthStatus, Filter, GitHubBillingData, UsageSnapshot } from '../domain/types';
import { DAY_MS, startOf } from '../util/time';
import { GitHubUsageService } from '../billing/GitHubUsageService';
import { LogWatcher } from '../ingest/LogWatcher';
import { PricingService } from '../pricing/PricingService';
import { EventStore } from '../store/EventStore';
import { UserConfigStore } from './UserConfigStore';

/** Keep ~1h of recent samples for velocity alerting. */
const HISTORY_WINDOW_MS = 60 * 60 * 1000;

export class UsageService implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<UsageSnapshot>();
  readonly onDidChangeSnapshot = this._onDidChange.event;

  private snapshot?: UsageSnapshot;
  private filter: Filter = {};
  private timer?: ReturnType<typeof setInterval>;
  private readonly alertFired = new Map<string, number>();
  private readonly history: SnapshotSample[] = [];
  private authStatus: AuthStatus = 'signed-out';
  private githubBilling: GitHubBillingData | undefined = undefined;
  private readonly subs: vscode.Disposable[] = [];

  constructor(
    private readonly store: EventStore,
    private readonly pricing: PricingService,
    private readonly watcher: LogWatcher,
    private readonly userConfig: UserConfigStore,
    private readonly github?: GitHubUsageService,
  ) {
    if (github) {
      // Re-fetch billing whenever the GitHub session changes.
      this.subs.push(github.session.onDidChange(() => void this.refreshGitHub()));
    }
    // Budget/included credits feed the snapshot, so recompute on config change.
    this.subs.push(userConfig.onDidChange(() => this.compute()));
  }

  get current(): UsageSnapshot | undefined {
    return this.snapshot;
  }

  getFilter(): Filter {
    return this.filter;
  }

  getLogPaths(): string[] {
    return this.watcher.getLogPaths();
  }

  getSearchedDirs(): string[] {
    return this.watcher.getSearchedDirs();
  }

  getKnownDirs(): string[] {
    return this.watcher.getKnownDirs();
  }

  getStatus() {
    return this.watcher.getStatus();
  }

  async setFilter(filter: Filter): Promise<void> {
    this.filter = filter;
    await this.compute();
  }

  async start(): Promise<void> {
    await this.store.load();
    await this.watcher.start();
    await this.compute();
    this.scheduleTimer();
    // Silent background fetch — does not block startup.
    void this.refreshGitHub();
  }

  onConfigChanged(): void {
    this.scheduleTimer();
    void this.compute();
  }

  async refresh(): Promise<void> {
    await this.watcher.start();
    await this.compute();
    void this.refreshGitHub();
  }

  /** Trigger explicit GitHub sign-in (shows a prompt). */
  async signInGitHub(): Promise<void> {
    if (!this.github) return;
    await this.github.session.get(true);
    await this.refreshGitHub();
  }

  private async refreshGitHub(): Promise<void> {
    if (!this.github) return;
    const result = await this.github.fetch();
    if (result.isOk()) {
      this.authStatus = 'signed-in';
      this.githubBilling = result.value;
    } else {
      const msg = result.error.message;
      this.authStatus = msg.includes('Not signed in') ? 'signed-out' : 'error';
      this.githubBilling = undefined;
    }
    await this.compute();
  }

  private async compute(): Promise<void> {
    const uc = this.userConfig.get();
    const now = Date.now();

    // Query by date range only, then apply the model/surface/repo selection in
    // memory. `universe` (range-only) drives the filter dropdowns so selecting a
    // value never collapses the list of choices; `filteredEvents` drives totals.
    const rangeStart = startOf(now - 365 * DAY_MS, 'day');
    const rangeFilter: Filter = this.filter.range ? { range: this.filter.range } : {};
    let universe = await this.store.query(rangeFilter);
    if (!this.filter.range) universe = universe.filter((e) => e.ts >= rangeStart);
    const filteredEvents = universe.filter((e) => matchesFilter(e, this.filter));

    const source =
      filteredEvents.length > 0
        ? filteredEvents.some((e) => e.source === 'local')
          ? 'local'
          : 'lm'
        : 'local';

    const options: SnapshotOptions = {
      now,
      currency: 'USD',
      pricePerCredit: this.pricing.pricePerCredit,
      monthlyBudget: uc.monthlyBudget > 0 ? uc.monthlyBudget : null,
      includedCredits: uc.includedCredits,
      filter: this.filter,
      source,
      status: filteredEvents.length === 0 ? this.watcher.getStatus() : { kind: 'ok' },
      authStatus: this.authStatus,
      ...(this.githubBilling !== undefined ? { githubBilling: this.githubBilling } : {}),
      dimensionEvents: universe,
    };

    this.snapshot = buildSnapshot(filteredEvents, options);
    this.recordSample(now, this.snapshot);
    this.fireAlerts(this.snapshot, uc, now);
    this._onDidChange.fire(this.snapshot);
  }

  private recordSample(now: number, s: UsageSnapshot): void {
    this.history.push({ ts: now, todayCredits: s.today.credits });
    const cutoff = now - HISTORY_WINDOW_MS;
    while (this.history.length > 0 && this.history[0]!.ts < cutoff) this.history.shift();
  }

  private fireAlerts(s: UsageSnapshot, uc: ReturnType<UserConfigStore['get']>, now: number): void {
    const alerts = evaluateAlerts(s, this.history, uc, this.alertFired, now);
    for (const a of alerts) {
      void vscode.window.showWarningMessage(a.message);
      this.alertFired.set(a.key, now);
    }
  }

  private scheduleTimer(): void {
    if (this.timer) clearInterval(this.timer);
    // Re-parse logs every 10 minutes as a fallback for environments where fs.watch is unavailable.
    this.timer = setInterval(() => void this.refresh(), 10 * 60_000);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.watcher.dispose();
    this._onDidChange.dispose();
    this.subs.forEach((d) => d.dispose());
    this.github?.dispose();
  }
}
