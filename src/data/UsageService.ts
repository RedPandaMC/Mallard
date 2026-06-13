/**
 * Orchestrates LogWatcher → EventStore → UsageSnapshot and emits one
 * `onDidChangeSnapshot` stream that the status bar, dashboard, and sidebar
 * all subscribe to.
 */
import * as vscode from 'vscode';
import { readConfig } from '../config';
import { buildSnapshot, SnapshotOptions } from '../model/snapshot';
import { AuthStatus, Filter, GitHubBillingData, UsageSnapshot } from '../model/types';
import { DAY_MS, startOf } from '../util/time';
import { GitHubUsageService } from './GitHubUsageService';
import { LogWatcher } from './LogWatcher';
import { PricingService } from './PricingService';
import { EventStore } from './store/EventStore';

const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours
const ALERT_DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export class UsageService implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<UsageSnapshot>();
  readonly onDidChangeSnapshot = this._onDidChange.event;

  private snapshot?: UsageSnapshot;
  private filter: Filter = {};
  private timer?: ReturnType<typeof setInterval>;
  private readonly alertFired = new Map<string, number>();
  private authStatus: AuthStatus = 'signed-out';
  private githubBilling: GitHubBillingData | undefined = undefined;
  private readonly ghSub: vscode.Disposable | undefined;

  constructor(
    private readonly store: EventStore,
    private readonly pricing: PricingService,
    private readonly watcher: LogWatcher,
    private readonly github?: GitHubUsageService,
  ) {
    if (github) {
      // Re-fetch billing whenever the GitHub session changes.
      this.ghSub = github.session.onDidChange(() => void this.refreshGitHub());
    }
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

  getStatus() {
    return this.watcher.getStatus();
  }

  async setFilter(filter: Filter): Promise<void> {
    this.filter = filter;
    this.compute();
  }

  async start(): Promise<void> {
    await this.store.load();
    await this.watcher.start();
    this.compute();
    this.scheduleTimer();
    // Silent background fetch — does not block startup.
    void this.refreshGitHub();
  }

  onConfigChanged(): void {
    this.scheduleTimer();
    this.compute();
  }

  async refresh(): Promise<void> {
    await this.watcher.start();
    this.compute();
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
    this.compute();
  }

  private compute(): void {
    const cfg = readConfig();
    const now = Date.now();
    const events = this.store.query(this.filter);

    const rangeStart = startOf(now - 365 * DAY_MS, 'day');
    const filteredEvents =
      this.filter.range
        ? events
        : events.filter((e) => e.ts >= rangeStart);

    const source =
      filteredEvents.length > 0
        ? (filteredEvents.some((e) => e.source === 'local') ? 'local' : 'lm')
        : 'local';

    const options: SnapshotOptions = {
      now,
      currency: 'USD',
      pricePerCredit: this.pricing.pricePerCredit,
      monthlyBudget: cfg.monthlyBudget > 0 ? cfg.monthlyBudget : null,
      includedCredits: cfg.includedCredits,
      filter: this.filter,
      source,
      status: filteredEvents.length === 0 ? this.watcher.getStatus() : { kind: 'ok' },
      authStatus: this.authStatus,
      ...(this.githubBilling !== undefined ? { githubBilling: this.githubBilling } : {}),
      manifest: this.pricing.currentManifest,
    };

    this.snapshot = buildSnapshot(filteredEvents, options);
    this.checkAlerts(this.snapshot, cfg);
    this._onDidChange.fire(this.snapshot);
  }

  private checkAlerts(s: UsageSnapshot, cfg: ReturnType<typeof readConfig>): void {
    const now = Date.now();

    if (cfg.monthlyBudget > 0) {
      const at80 = `budget-80-${new Date().getMonth()}`;
      const at100 = `budget-100-${new Date().getMonth()}`;
      if (
        s.budget.percentOfBudget >= 0.8 &&
        s.budget.percentOfBudget < 1.0 &&
        this.canFireAlert(at80, ALERT_COOLDOWN_MS, now)
      ) {
        void vscode.window.showWarningMessage(
          `Weevil: You've used 80% of your $${cfg.monthlyBudget} monthly budget.`,
        );
        this.alertFired.set(at80, now);
      }
      if (
        s.budget.percentOfBudget >= 1.0 &&
        this.canFireAlert(at100, ALERT_COOLDOWN_MS, now)
      ) {
        void vscode.window.showWarningMessage(
          `Weevil: Monthly budget of $${cfg.monthlyBudget} exceeded.`,
        );
        this.alertFired.set(at100, now);
      }
    }

    if (cfg.alertDailyCredits > 0) {
      const key = `daily-${new Date().toDateString()}`;
      if (
        s.today.credits >= cfg.alertDailyCredits &&
        this.canFireAlert(key, ALERT_DAILY_COOLDOWN_MS, now)
      ) {
        void vscode.window.showWarningMessage(
          `Weevil: Daily credit usage (${Math.round(s.today.credits)}) exceeded your threshold of ${cfg.alertDailyCredits}.`,
        );
        this.alertFired.set(key, now);
      }
    }
  }

  private canFireAlert(key: string, cooldown: number, now: number): boolean {
    const last = this.alertFired.get(key);
    return last === undefined || now - last > cooldown;
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
    this.ghSub?.dispose();
    this.github?.dispose();
  }
}
