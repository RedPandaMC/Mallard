/**
 * TEST FIXTURE ONLY — an in-memory events → UsageSnapshot builder used by
 * downstream-consumer tests (payload, report, charts, exporter, …) to get a
 * realistic snapshot without spinning up DuckDB.
 *
 * This deliberately lives in test/ and NOT in src/: production has exactly one
 * snapshot engine — the DuckDB aggregation in EventReader.readFilteredSnapshot,
 * assembled by UsageService — which is directly tested (see
 * store/filteredSnapshot.test.ts, store/snapshotParity.test.ts, and
 * app/usageService.test.ts). Keeping this builder as a test fixture avoids the
 * old "third engine" that ran only in tests and gave false confidence about the
 * production path. It reuses the production shared aggregation utilities and the
 * production chart/budget/forecast helpers, so it exercises the same building
 * blocks the real path does.
 */
import {
  aggregateBy,
  distinctModels,
  distinctRepos,
  distinctSources,
  distinctSurfaces,
  sankeyLinksFor,
  sumEvents,
  topBy,
} from '../../src/extension-backend/domain/aggregate';
import { computeBudget } from '../../src/extension-backend/domain/budget';
import {
  buildCategoryBreakdownData,
  buildChartData,
  buildHourlyTimelineData,
  buildWeekdayTotals,
} from '../../src/extension-backend/domain/chartData';
import { forecastMonth } from '../../src/extension-backend/domain/forecast';
import { isIncrementalUpdate } from '../../src/extension-backend/domain/snapshot';
import { PricingManifest } from '../../src/extension-backend/domain/pricing';
import {
  AuthStatus,
  Filter,
  GitHubBillingData,
  ProviderStatus,
  SnapshotSource,
  UsageEvent,
  UsageSnapshot,
} from '../../src/extension-backend/domain/types';
import { DAY_MS, nextBucketStart, startOf } from '../../src/extension-backend/util/time';

export interface SnapshotOptions {
  now: number;
  currency: string;
  pricePerCredit: number;
  fxRates?: Record<string, number>;
  monthlyBudget: number | null;
  includedCredits: number;
  filter: Filter;
  source: SnapshotSource;
  status: ProviderStatus;
  authStatus: AuthStatus;
  githubBilling?: GitHubBillingData;
  dimensionEvents?: UsageEvent[];
  prevSnapshot?: UsageSnapshot;
  manifest?: PricingManifest;
  currentBranch?: string;
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

export function buildSnapshot(events: readonly UsageEvent[], opts: SnapshotOptions): UsageSnapshot {
  // Production computes day aggregates in SQL; here we use the shared
  // aggregateBy helper for the one granularity the snapshot needs.
  const dayAggregates = aggregateBy(events, 'day', opts.filter);
  const forecast = forecastMonth(dayAggregates, opts.now, opts.pricePerCredit);

  const monthStart = startOf(opts.now, 'month');
  const monthEnd = nextBucketStart(opts.now, 'month');
  const mtd = sumEvents(events, { ...opts.filter, range: { start: monthStart, end: monthEnd } });

  const todayStart = startOf(opts.now, 'day');
  const todayEnd = nextBucketStart(opts.now, 'day');
  const todayTotals = sumEvents(events, { ...opts.filter, range: { start: todayStart, end: todayEnd } });

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
    fxRates: opts.fxRates ?? { USD: 1 },
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
      buildWeekdayTotals(events, opts.filter),
    ),
    authStatus: opts.authStatus,
    isIncremental: false,
    currentBranchCredits,
    ...(opts.currentBranch !== undefined ? { currentBranch: opts.currentBranch } : {}),
    ...(opts.githubBilling !== undefined ? { githubBilling: opts.githubBilling } : {}),
  };
  next.isIncremental = isIncrementalUpdate(opts.prevSnapshot, next);
  return next;
}
