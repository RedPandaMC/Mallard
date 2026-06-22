/* c8 ignore start */
/**
 * Pure assembly of a UsageSnapshot from raw events + options.
 */
import {
  aggregateAll,
  distinctModels,
  distinctRepos,
  distinctSources,
  distinctSurfaces,
  sankeyLinksFor,
  sumEvents,
  topBy,
} from './aggregate';
import { computeBudget } from './budget';
import { buildCategoryBreakdownData, buildChartData, buildHourlyTimelineData } from './chartData';
import { forecastMonth } from './forecast';
import { PricingManifest } from './pricing';
import {
  AuthStatus,
  Filter,
  GitHubBillingData,
  ProviderStatus,
  SourceKind,
  UsageEvent,
  UsageSnapshot,
} from './types';
import { DAY_MS, nextBucketStart, startOf } from '../util/time';
/* c8 ignore stop */

export interface SnapshotOptions {
  now: number;
  currency: string;
  pricePerCredit: number;
  monthlyBudget: number | null;
  includedCredits: number;
  filter: Filter;
  source: SourceKind;
  status: ProviderStatus;
  authStatus: AuthStatus;
  githubBilling?: GitHubBillingData;
  /**
   * Events for the current date range ignoring the model/surface/repo selection.
   * Drives the filter dropdowns so selecting a value never collapses the choices.
   * Defaults to the filtered events when omitted.
   */
  dimensionEvents?: UsageEvent[];
  /** Previous snapshot — used to detect incremental (today-only) updates. */
  prevSnapshot?: UsageSnapshot;
  /** Pricing manifest for cheapest-equivalent model comparison. */
  manifest?: PricingManifest;
  /** Currently active git branch, for per-branch credit tracking. */
  currentBranch?: string;
}

function isIncrementalUpdate(prev: UsageSnapshot | undefined, next: UsageSnapshot): boolean {
  if (!prev) return false;
  if (JSON.stringify(prev.filter) !== JSON.stringify(next.filter)) return false;
  const prevPts = prev.chartData.dailyBars.points;
  const nextPts = next.chartData.dailyBars.points;
  if (prevPts.length !== nextPts.length) return false;
  for (let i = 0; i < prevPts.length - 1; i++) {
    const prevPoint = prevPts[i]!;
    const nextPoint = nextPts[i]!;
    if (prevPoint.date !== nextPoint.date || prevPoint.credits !== nextPoint.credits) return false;
  }
  const prevLastPoint = prevPts[prevPts.length - 1];
  const nextLastPoint = nextPts[nextPts.length - 1];
  return !!prevLastPoint && !!nextLastPoint && prevLastPoint.date === nextLastPoint.date;
}

function computeRange(events: readonly UsageEvent[], now: number): { start: number; end: number } {
  if (events.length === 0) {
    return { start: startOf(now - 29 * DAY_MS, 'day'), end: now };
  }
  let min = events[0]!.ts;
  let max = events[0]!.ts;
  for (const e of events) {
    if (e.ts < min) min = e.ts;
    if (e.ts > max) max = e.ts;
  }
  return { start: min, end: max };
}

/* c8 ignore next */
export function buildSnapshot(events: readonly UsageEvent[], opts: SnapshotOptions): UsageSnapshot {
  const aggregates = aggregateAll(events, opts.filter);
  const dayAggregates = aggregates.day;
  const forecast = forecastMonth(dayAggregates, opts.now, opts.pricePerCredit);

  const monthStart = startOf(opts.now, 'month');
  const monthEnd = nextBucketStart(opts.now, 'month');
  const mtdFilter: Filter = { ...opts.filter, range: { start: monthStart, end: monthEnd } };
  const mtd = sumEvents(events, mtdFilter);

  const todayStart = startOf(opts.now, 'day');
  const todayEnd = nextBucketStart(opts.now, 'day');
  const todayFilter: Filter = { ...opts.filter, range: { start: todayStart, end: todayEnd } };
  const todayTotals = sumEvents(events, todayFilter);

  const budget = computeBudget({
    monthlyBudget: opts.monthlyBudget,
    includedCredits: opts.includedCredits,
    mtdCredits: mtd.credits,
    mtdCost: mtd.cost,
    forecast,
  });

  const topModels = topBy(events, 'model', opts.filter);
  const dim = opts.dimensionEvents ?? events;

  const currentBranchCredits = opts.currentBranch
    ? events.filter((e) => e.branch === opts.currentBranch).reduce((sum, e) => sum + e.credits, 0)
    : 0;

  const next: UsageSnapshot = {
    generatedAt: opts.now,
    source: opts.source,
    status: opts.status,
    currency: opts.currency,
    pricePerCredit: opts.pricePerCredit,
    filter: opts.filter,
    range: computeRange(events, opts.now),
    forecast,
    budget,
    topModels,
    today: { credits: todayTotals.credits, cost: todayTotals.cost, tokens: todayTotals.tokens },
    allModels: distinctModels(dim),
    allSurfaces: distinctSurfaces(dim),
    allSources: distinctSources(dim),
    sankeyLinks: sankeyLinksFor(events, opts.filter),
    allRepos: distinctRepos(dim),
    byRepo: topBy(events, 'repo', opts.filter),
    chartData: buildChartData(
      dayAggregates,
      topModels,
      budget,
      forecast,
      opts.now,
      buildCategoryBreakdownData(events, opts.filter),
      buildHourlyTimelineData(events, opts.filter),
      opts.pricePerCredit,
      opts.manifest,
    ),
    authStatus: opts.authStatus,
    isIncremental: false,
    currentBranchCredits,
    ...(opts.currentBranch !== undefined ? { currentBranch: opts.currentBranch } : {}),
    /* c8 ignore next */
    ...(opts.githubBilling !== undefined ? { githubBilling: opts.githubBilling } : {}),
  };
  next.isIncremental = isIncrementalUpdate(opts.prevSnapshot, next);
  return next;
}
