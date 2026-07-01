/**
 * Orchestrates IngestService → EventReader → UsageSnapshot and emits one
 * `onDidChangeSnapshot` stream that the status bar, dashboard, and sidebar
 * all subscribe to.
 */
import * as vscode from 'vscode';
import { evaluateAlerts, SnapshotSample } from '../domain/alerts';
import { evaluateAlertRules, shouldNotify } from '../domain/alertRules';
import { computeBudget } from '../domain/budget';
import { buildChartData } from '../domain/chartData';
import { forecastMonth } from '../domain/forecast';
import { isIncrementalUpdate } from '../domain/snapshot';
import {
  AuthStatus,
  COST_CATEGORIES,
  Filter,
  GitHubBillingData,
  SourceKind,
  Surface,
  SURFACES,
  SOURCE_KINDS,
  UsageAggregate,
  UsageSnapshot,
} from '../domain/types';
import { DAY_MS, bucketKey, nextBucketStart, startOf } from '../util/time';
import { opt } from '../util/lang';
import type { IBillingProvider } from '../billing/IBillingProvider';
import { IngestService } from '../ingest/IngestService';
import { PricingService } from '../pricing/PricingService';
import { CurrencyService } from '../pricing/CurrencyService';
import type { IEventSnapshotReader } from '../store/EventReader';
import type { RecordFilter } from '../store/EventRepository';
import { UserConfigStore } from './UserConfigStore';
import { MetricExporter, NullMetricExporter } from '../export/MetricExporter';
import { activeBranch } from '../util/repo';
import { defaultVscodeHost, VscodeHost } from '../util/vscodeHost';
import { IntervalManager } from '../util/IntervalManager';

/** Keep ~1h of recent samples for velocity alerting. */
const HISTORY_WINDOW_MS = 60 * 60 * 1000;

function isEmptyFilter(f: Filter): boolean {
  return !f.range && !f.models?.length && !f.surfaces?.length &&
         !f.repos?.length && !f.branches?.length && !f.sources?.length;
}

export class UsageService implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<UsageSnapshot>();
  readonly onDidChangeSnapshot = this._onDidChange.event;

  private snapshot?: UsageSnapshot;
  private filter: Filter = {};
  private readonly timer = new IntervalManager();
  private readonly alertFired = new Map<string, number>();
  private readonly history: SnapshotSample[] = [];
  private authStatus: AuthStatus = 'signed-out';
  private githubBilling: GitHubBillingData | undefined = undefined;
  private readonly subs: vscode.Disposable[] = [];
  private readonly exporter: MetricExporter;

  constructor(
    private readonly reader: IEventSnapshotReader,
    private readonly pricing: PricingService,
    private readonly ingest: IngestService,
    private readonly userConfig: UserConfigStore,
    private readonly currency: CurrencyService,
    private readonly github?: IBillingProvider,
    exporter: MetricExporter = new NullMetricExporter(),
    private readonly host: VscodeHost = defaultVscodeHost,
  ) {
    this.exporter = exporter;
    if (github) {
      this.subs.push(github.onDidChange(() => void this.refreshGitHub()));
    }
    this.subs.push(userConfig.onDidChange(() => this.compute()));
  }

  get current(): UsageSnapshot | undefined {
    return this.snapshot;
  }

  getFilter(): Filter {
    return this.filter;
  }

  getLogPaths(): string[] {
    return this.ingest.getLogPaths();
  }

  getSearchedDirs(): string[] {
    return this.ingest.getSearchedDirs();
  }

  getKnownDirs(): string[] {
    return this.ingest.getKnownDirs();
  }

  getStatus() {
    return this.ingest.getStatus();
  }

  async setFilter(filter: Filter): Promise<void> {
    this.filter = filter;
    await this.compute();
  }

  async start(): Promise<void> {
    // Emit an immediate snapshot so the dashboard shows a loading state
    // while the initial log parse runs in the background.
    await this.compute();
    this.scheduleTimer();
    void this.refreshGitHub();
    void this.ingest.start().then(() => this.compute());
  }

  onConfigChanged(): void {
    this.scheduleTimer();
    void this.compute();
  }

  async refresh(): Promise<void> {
    await this.ingest.start();
    await this.compute();
    void this.refreshGitHub();
  }

  async signInGitHub(): Promise<void> {
    if (!this.github) return;
    await this.github.signIn?.();
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
    const userConfig = this.userConfig.get();
    const now = Date.now();
    for (const [key, ts] of this.alertFired)
      if (now - ts > 86_400_000) this.alertFired.delete(key);

    const branch = activeBranch();

    const displayCurrency = vscode.workspace.getConfiguration('mallard')
      .get<string>('currency', 'USD').trim().toUpperCase() || 'USD';
    const fxRates = this.currency.currentRates();
    const fxRate = displayCurrency !== 'USD' ? (fxRates[displayCurrency] ?? 1) : 1;

    if (isEmptyFilter(this.filter)) {
      await this.computeFromCache(now, userConfig, branch, displayCurrency, fxRate);
    } else {
      await this.computeFromEvents(now, userConfig, branch, displayCurrency, fxRate);
    }
  }

  /** Fast path: read pre-materialized snap_* tables — no raw event scan. */
  private async computeFromCache(
    now: number,
    userConfig: ReturnType<UserConfigStore['get']>,
    branch: string | undefined,
    displayCurrency: string,
    fxRate: number,
  ): Promise<void> {
    const [cache, currentBranchCredits] = await Promise.all([
      this.reader.readSnapshotCache(),
      branch ? this.reader.creditsByBranch(branch) : Promise.resolve(0),
    ]);

    // ── Day aggregates (for forecast + chart) ──────────────────────────────
    const dayAggregates: UsageAggregate[] = cache.daily.map((row) => ({
      granularity: 'day',
      bucketKey:   bucketKey(row.dayStart, 'day'),
      start:       row.dayStart,
      end:         nextBucketStart(row.dayStart, 'day'),
      credits:     row.credits,
      cost:        row.cost * fxRate,
      tokens:      Number(row.tokens),
      byModel:     {},
      eventCount:  row.eventCount,
      estimated:   false,
    }));

    const forecast = forecastMonth(dayAggregates, now, this.pricing.pricePerCredit * fxRate);

    const budget = computeBudget({
      monthlyBudget:   userConfig.monthlyBudget > 0 ? userConfig.monthlyBudget : null,
      includedCredits: userConfig.includedCredits,
      mtdCredits:      cache.totals.mtd.credits,
      mtdCost:         cache.totals.mtd.cost * fxRate,
      forecast,
    });

    // ── Dimensions ──────────────────────────────────────────────────────────
    const allModels   = cache.dims.models;
    const allSurfaces = cache.dims.surfaces.filter((s): s is Surface    => SURFACES.has(s as Surface));
    const allSources  = cache.dims.sources.filter( (s): s is SourceKind => SOURCE_KINDS.has(s as SourceKind));
    const allRepos    = cache.dims.repos;

    const topModels = cache.models.map((m) => ({
      key:     m.modelId,
      credits: m.credits,
      cost:    m.cost * fxRate,
      tokens:  Number(m.tokens),
    }));

    const byRepo = cache.repos.map((r) => ({
      key:     r.repo,
      credits: r.credits,
      cost:    r.cost * fxRate,
      tokens:  Number(r.tokens),
    }));

    const sankeyLinks = cache.sankey.map((s) => ({
      source: s.model,
      target: s.surface,
      value:  s.credits,
    }));

    // ── Chart data ──────────────────────────────────────────────────────────
    const catMap = new Map(cache.categories.map((c) => [c.category, c.cost]));
    const catKeys = COST_CATEGORIES.filter((c) => (catMap.get(c) ?? 0) > 0);
    const categoryBreakdown = catKeys.length > 0
      ? { categories: catKeys, costs: catKeys.map((c) => catMap.get(c) ?? 0), available: true }
      : { categories: [] as typeof catKeys, costs: [] as number[], available: false };

    const hourArr = new Array<number>(24).fill(0);
    for (const h of cache.hourly) hourArr[h.hourLocal] = h.credits;
    const peakHour = hourArr.indexOf(Math.max(...hourArr));
    const hourlyTimeline = { hours: hourArr, peakHour };

    const chartData = buildChartData(
      dayAggregates, topModels, budget, forecast, now,
      categoryBreakdown, hourlyTimeline,
      this.pricing.pricePerCredit * fxRate, this.pricing.currentManifest,
      cache.weekday,
      userConfig.display,
    );

    // ── Range from snap_daily extent ───────────────────────────────────────
    const rangeStart = cache.daily[0]?.dayStart ?? startOf(now - 29 * DAY_MS, 'day');
    const rangeEnd   = (cache.daily[cache.daily.length - 1]?.dayStart ?? now) + DAY_MS;

    const hasData = cache.totals.all.eventCount > 0;
    const source: SourceKind = allSources.includes('local') ? 'local' : (hasData ? 'lm' : 'local');

    const next: UsageSnapshot = {
      generatedAt:   now,
      source,
      status:        hasData ? { kind: 'ok' } : this.ingest.getStatus(),
      currency:      displayCurrency,
      pricePerCredit: this.pricing.pricePerCredit * fxRate,
      fxRates:       this.currency.currentRates(),
      filter:        this.filter,
      range:         { start: rangeStart, end: rangeEnd },
      forecast,
      budget,
      topModels,
      today:         { credits: cache.totals.today.credits, cost: cache.totals.today.cost * fxRate, tokens: Number(cache.totals.today.tokens) },
      allModels,
      allSurfaces,
      allSources,
      sankeyLinks,
      allRepos,
      byRepo,
      chartData,
      authStatus:    this.authStatus,
      isIncremental: false,
      currentBranchCredits,
      ...opt('currentBranch', branch),
      ...opt('githubBilling', this.githubBilling),
    };

    this.snapshot = next;
    this.recordSample(now, next);
    this.fireAlerts(next, userConfig, now);
    this._onDidChange.fire(next);
    // intentionally not awaited — see ExportQueue; export() persists a durable
    // retry queue on failure, so a slow/unreachable endpoint never blocks the UI.
    void this.exporter.export(next);
  }

  /** Filtered path: all aggregations pushed to DuckDB; no raw event transfer. */
  private async computeFromEvents(
    now: number,
    userConfig: ReturnType<UserConfigStore['get']>,
    branch: string | undefined,
    displayCurrency: string,
    fxRate: number,
  ): Promise<void> {
    const rangeStart = startOf(now - 365 * DAY_MS, 'day');
    const effectiveRange = this.filter.range ?? { start: rangeStart, end: now + DAY_MS };
    const filter: RecordFilter = { ...this.filter, range: effectiveRange };

    const [data, currentBranchCredits] = await Promise.all([
      this.reader.readFilteredSnapshot(filter),
      branch ? this.reader.creditsByBranch(branch) : Promise.resolve(0),
    ]);

    // ── Day aggregates (for forecast + chart) ──────────────────────────────
    const dayAggregates: UsageAggregate[] = data.daily.map((row) => ({
      granularity: 'day',
      bucketKey:   bucketKey(row.dayStart, 'day'),
      start:       row.dayStart,
      end:         nextBucketStart(row.dayStart, 'day'),
      credits:     row.credits,
      cost:        row.cost * fxRate,
      tokens:      Number(row.tokens),
      byModel:     {},
      eventCount:  row.eventCount,
      estimated:   false,
    }));

    const forecast = forecastMonth(dayAggregates, now, this.pricing.pricePerCredit * fxRate);
    const budget   = computeBudget({
      monthlyBudget:   userConfig.monthlyBudget > 0 ? userConfig.monthlyBudget : null,
      includedCredits: userConfig.includedCredits,
      mtdCredits:      data.totals.mtd.credits,
      mtdCost:         data.totals.mtd.cost * fxRate,
      forecast,
    });

    // ── Dimensions ──────────────────────────────────────────────────────────
    const allModels   = data.dims.models;
    const allSurfaces = data.dims.surfaces.filter((s): s is Surface    => SURFACES.has(s as Surface));
    const allSources  = data.dims.sources.filter( (s): s is SourceKind => SOURCE_KINDS.has(s as SourceKind));
    const allRepos    = data.dims.repos;

    const topModels = data.topModels.map((m) => ({ key: m.modelId, credits: m.credits, cost: m.cost * fxRate, tokens: Number(m.tokens) }));
    const byRepo    = data.topRepos.map( (r) => ({ key: r.repo,    credits: r.credits, cost: r.cost * fxRate, tokens: Number(r.tokens) }));
    const sankeyLinks = data.sankey.map((s) => ({ source: s.model, target: s.surface, value: s.credits }));

    // ── Chart data ──────────────────────────────────────────────────────────
    const catMap  = new Map(data.categories.map((c) => [c.category, c.cost]));
    const catKeys = COST_CATEGORIES.filter((c) => (catMap.get(c) ?? 0) > 0);
    const categoryBreakdown = catKeys.length > 0
      ? { categories: catKeys, costs: catKeys.map((c) => catMap.get(c) ?? 0), available: true }
      : { categories: [] as typeof catKeys, costs: [] as number[], available: false };

    const hourArr = new Array<number>(24).fill(0);
    for (const h of data.hourly) hourArr[h.hourLocal] = h.credits;
    const peakHour = hourArr.indexOf(Math.max(...hourArr));
    const hourlyTimeline = { hours: hourArr, peakHour };

    const chartData = buildChartData(
      dayAggregates, topModels, budget, forecast, now,
      categoryBreakdown, hourlyTimeline,
      this.pricing.pricePerCredit * fxRate, this.pricing.currentManifest,
      data.weekday,
      userConfig.display,
    );

    // ── Assemble snapshot ───────────────────────────────────────────────────
    const hasData    = data.totals.all.eventCount > 0;
    const source: SourceKind = allSources.includes('local') ? 'local' : (hasData ? 'lm' : 'local');
    const rangeStart2 = data.daily[0]?.dayStart ?? startOf(now - 29 * DAY_MS, 'day');
    const rangeEnd   = (data.daily[data.daily.length - 1]?.dayStart ?? now) + DAY_MS;

    const next: UsageSnapshot = {
      generatedAt:   now,
      source,
      status:        hasData ? { kind: 'ok' } : this.ingest.getStatus(),
      currency:      displayCurrency,
      pricePerCredit: this.pricing.pricePerCredit * fxRate,
      fxRates:       this.currency.currentRates(),
      filter:        this.filter,
      range:         { start: rangeStart2, end: rangeEnd },
      forecast,
      budget,
      topModels,
      today:         { credits: data.totals.today.credits, cost: data.totals.today.cost * fxRate, tokens: Number(data.totals.today.tokens) },
      allModels,
      allSurfaces,
      allSources,
      sankeyLinks,
      allRepos,
      byRepo,
      chartData,
      authStatus:    this.authStatus,
      isIncremental: false,
      currentBranchCredits,
      ...opt('currentBranch', branch),
      ...opt('githubBilling', this.githubBilling),
    };
    next.isIncremental = isIncrementalUpdate(this.snapshot, next);

    this.snapshot = next;
    this.recordSample(now, next);
    this.fireAlerts(next, userConfig, now);
    this._onDidChange.fire(next);
    // intentionally not awaited — see ExportQueue; export() persists a durable
    // retry queue on failure, so a slow/unreachable endpoint never blocks the UI.
    void this.exporter.export(next);
  }

  private recordSample(now: number, s: UsageSnapshot): void {
    this.history.push({ ts: now, todayCredits: s.today.credits });
    const cutoff = now - HISTORY_WINDOW_MS;
    while (this.history.length > 0 && this.history[0]!.ts < cutoff) this.history.shift();
  }

  private fireAlerts(s: UsageSnapshot, uc: ReturnType<UserConfigStore['get']>, now: number): void {
    const alerts = evaluateAlerts(s, this.history, uc, this.alertFired, now);
    for (const a of alerts) {
      void this.host.showWarningMessage(a.message);
      this.alertFired.set(a.key, now);
    }

    const ruleResults = evaluateAlertRules({
      snapshot: s,
      history: this.history,
      rules: uc.rules ?? [],
      ...opt('groups', uc.groups),
      ...opt('vars', uc.vars),
      ...opt('branchBudgets', uc.branchBudgets),
      signedIn: s.authStatus === 'signed-in',
      fired: this.alertFired,
      now,
    });
    for (const r of ruleResults) {
      if (shouldNotify(r.rule)) void this.host.showWarningMessage(r.message);
    }
  }

  private scheduleTimer(): void {
    const mins = vscode.workspace.getConfiguration('mallard').get<number>('refreshIntervalMinutes', 10);
    this.timer.schedule(() => void this.refresh(), Math.max(1, mins) * 60_000);
  }

  dispose(): void {
    this.timer[Symbol.dispose]();
    this.ingest.dispose();
    this._onDidChange.dispose();
    this.subs.forEach((d) => d.dispose());
    this.github?.dispose();
  }
}
