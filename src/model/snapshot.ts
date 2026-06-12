/**
 * Pure assembly of a UsageSnapshot from raw events + options. Kept free of
 * `vscode` so it can be unit-tested directly; UsageService just feeds it data.
 */
import { aggregateAll, sumEvents, topBy } from './aggregate';
import { computeBudget } from './budget';
import { forecastMonth } from './forecast';
import {
  CurrentScopeTotals,
  Filter,
  ProviderStatus,
  SourceKind,
  StatusBarScope,
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
  statusBarScope: StatusBarScope;
  activeRepo?: string;
  activeWorkspace?: string;
  sessionStart: number;
}

function withRange(f: Filter, range: { start: number; end: number }): Filter {
  return { ...f, range };
}

function computeCurrent(events: UsageEvent[], o: SnapshotOptions): CurrentScopeTotals {
  const todayStart = startOf(o.now, 'day');
  const todayEnd = nextBucketStart(o.now, 'day');
  const monthStart = startOf(o.now, 'month');
  const monthEnd = nextBucketStart(o.now, 'month');

  let f: Filter;
  let label: string;
  switch (o.statusBarScope) {
    case 'session':
      f = { range: { start: o.sessionStart, end: o.now + 1 } };
      label = 'This session';
      break;
    case 'today':
      f = { range: { start: todayStart, end: todayEnd } };
      label = 'Today';
      break;
    case 'workspace':
      f = {
        range: { start: monthStart, end: monthEnd },
        workspaces: o.activeWorkspace ? [o.activeWorkspace] : undefined,
      };
      label = o.activeWorkspace ? `${o.activeWorkspace} · MTD` : 'Workspace · MTD';
      break;
    case 'repo':
      f = {
        range: { start: monthStart, end: monthEnd },
        repos: o.activeRepo ? [o.activeRepo] : undefined,
      };
      label = o.activeRepo ? `${o.activeRepo} · MTD` : 'Repo · MTD';
      break;
    default: {
      const _exhaustive: never = o.statusBarScope;
      throw new Error(`Unknown scope: ${_exhaustive}`);
    }
  }

  const s = sumEvents(events, f);
  return { scope: o.statusBarScope, label, credits: s.credits, tokens: s.tokens, cost: s.cost };
}

function computeRange(events: UsageEvent[], now: number): { start: number; end: number } {
  if (events.length === 0) {
    return { start: startOf(now - 29 * DAY_MS, 'day'), end: now };
  }
  let min = events[0].ts;
  let max = events[0].ts;
  for (const e of events) {
    if (e.ts < min) min = e.ts;
    if (e.ts > max) max = e.ts;
  }
  return { start: min, end: max };
}

export function buildSnapshot(events: UsageEvent[], o: SnapshotOptions): UsageSnapshot {
  const aggregates = aggregateAll(events, o.filter);
  const forecast = forecastMonth(aggregates.day, o.now, o.pricePerCredit);

  const monthStart = startOf(o.now, 'month');
  const monthEnd = nextBucketStart(o.now, 'month');
  const mtd = sumEvents(events, withRange(o.filter, { start: monthStart, end: monthEnd }));

  const budget = computeBudget({
    monthlyBudget: o.monthlyBudget,
    includedCredits: o.includedCredits,
    mtdCredits: mtd.credits,
    mtdCost: mtd.cost,
    forecast,
  });

  return {
    generatedAt: o.now,
    source: o.source,
    status: o.status,
    currency: o.currency,
    pricePerCredit: o.pricePerCredit,
    filter: o.filter,
    range: computeRange(events, o.now),
    aggregates,
    forecast,
    budget,
    topModels: topBy(events, 'model', o.filter),
    topRepos: topBy(events, 'repo', o.filter),
    current: computeCurrent(events, o),
  };
}
