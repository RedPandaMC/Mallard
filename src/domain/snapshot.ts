/**
 * Pure assembly of a UsageSnapshot from raw events + options.
 */
import {
  aggregateAll,
  distinctModels,
  distinctRepos,
  distinctSurfaces,
  sankeyLinksFor,
  sumEvents,
  topBy,
} from './aggregate';
import { computeBudget } from './budget';
import { buildCategoryBreakdownData, buildChartData } from './chartData';
import { forecastMonth } from './forecast';
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
  manifest?: import('./pricing').PricingManifest;
}

function computeRange(events: UsageEvent[], now: number): { start: number; end: number } {
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

export function buildSnapshot(events: UsageEvent[], o: SnapshotOptions): UsageSnapshot {
  const aggregates = aggregateAll(events, o.filter);
  const dayAggregates = aggregates.day;
  const forecast = forecastMonth(dayAggregates, o.now, o.pricePerCredit);

  const monthStart = startOf(o.now, 'month');
  const monthEnd = nextBucketStart(o.now, 'month');
  const mtdFilter: Filter = { ...o.filter, range: { start: monthStart, end: monthEnd } };
  const mtd = sumEvents(events, mtdFilter);

  const todayStart = startOf(o.now, 'day');
  const todayEnd = nextBucketStart(o.now, 'day');
  const todayFilter: Filter = { ...o.filter, range: { start: todayStart, end: todayEnd } };
  const todayTotals = sumEvents(events, todayFilter);

  const budget = computeBudget({
    monthlyBudget: o.monthlyBudget,
    includedCredits: o.includedCredits,
    mtdCredits: mtd.credits,
    mtdCost: mtd.cost,
    forecast,
  });

  const topModels = topBy(events, 'model', o.filter);

  return {
    generatedAt: o.now,
    source: o.source,
    status: o.status,
    currency: o.currency,
    pricePerCredit: o.pricePerCredit,
    filter: o.filter,
    range: computeRange(events, o.now),
    forecast,
    budget,
    topModels,
    today: { credits: todayTotals.credits, cost: todayTotals.cost, tokens: todayTotals.tokens },
    allModels: distinctModels(events),
    allSurfaces: distinctSurfaces(events),
    sankeyLinks: sankeyLinksFor(events, o.filter),
    allRepos: distinctRepos(events),
    byRepo: topBy(events, 'repo', o.filter),
    chartData: buildChartData(
      dayAggregates,
      topModels,
      budget,
      forecast,
      o.now,
      buildCategoryBreakdownData(events, o.filter),
    ),
    authStatus: o.authStatus,
    ...(o.githubBilling !== undefined ? { githubBilling: o.githubBilling } : {}),
  };
}
