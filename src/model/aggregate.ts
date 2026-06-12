/**
 * Pure aggregation: turn a flat list of UsageEvents into per-granularity
 * buckets (with per-model and per-repo breakdowns) and ranked top lists.
 */
import {
  Bucket,
  Filter,
  Granularity,
  GRANULARITIES,
  TopEntry,
  UsageAggregate,
  UsageEvent,
} from './types';
import { bucketKey, nextBucketStart, startOf } from '../util/time';

export function tokensOf(e: UsageEvent): number {
  return (e.promptTokens ?? 0) + (e.completionTokens ?? 0);
}

export function matchesFilter(e: UsageEvent, f?: Filter): boolean {
  if (!f) return true;
  if (f.range && (e.ts < f.range.start || e.ts >= f.range.end)) return false;
  if (f.repos?.length && !f.repos.includes(e.repo ?? 'unknown')) return false;
  if (f.workspaces?.length && !f.workspaces.includes(e.workspaceFolder ?? 'unknown')) return false;
  if (f.models?.length && !f.models.includes(e.modelId)) return false;
  if (f.surfaces?.length && !f.surfaces.includes(e.surface)) return false;
  if (f.sources?.length && !f.sources.includes(e.source)) return false;
  return true;
}

function addTo(rec: Record<string, Bucket>, key: string, e: UsageEvent, tk: number): void {
  const b = rec[key] ?? (rec[key] = { credits: 0, cost: 0, tokens: 0 });
  b.credits += e.credits;
  b.cost += e.cost;
  b.tokens += tk;
}

export function aggregateBy(
  events: UsageEvent[],
  g: Granularity,
  f?: Filter,
): UsageAggregate[] {
  const map = new Map<string, UsageAggregate>();
  for (const e of events) {
    if (!matchesFilter(e, f)) continue;
    const key = bucketKey(e.ts, g);
    let agg = map.get(key);
    if (!agg) {
      agg = {
        granularity: g,
        bucketKey: key,
        start: startOf(e.ts, g),
        end: nextBucketStart(e.ts, g),
        credits: 0,
        cost: 0,
        tokens: 0,
        byModel: {},
        byRepo: {},
        eventCount: 0,
        estimated: false,
      };
      map.set(key, agg);
    }
    const tk = tokensOf(e);
    agg.credits += e.credits;
    agg.cost += e.cost;
    agg.tokens += tk;
    agg.eventCount += 1;
    agg.estimated = agg.estimated || e.estimated;
    addTo(agg.byModel, e.modelId, e, tk);
    addTo(agg.byRepo, e.repo ?? 'unknown', e, tk);
  }
  return [...map.values()].sort((a, b) => a.start - b.start);
}

export function aggregateAll(
  events: UsageEvent[],
  f?: Filter,
): Record<Granularity, UsageAggregate[]> {
  const out = {} as Record<Granularity, UsageAggregate[]>;
  for (const g of GRANULARITIES) out[g] = aggregateBy(events, g, f);
  return out;
}

export function topBy(
  events: UsageEvent[],
  dimension: 'model' | 'repo',
  f?: Filter,
  limit = 5,
): TopEntry[] {
  const map = new Map<string, TopEntry>();
  for (const e of events) {
    if (!matchesFilter(e, f)) continue;
    const key = dimension === 'model' ? e.modelId : e.repo ?? 'unknown';
    const t = map.get(key) ?? { key, credits: 0, cost: 0, tokens: 0 };
    t.credits += e.credits;
    t.cost += e.cost;
    t.tokens += tokensOf(e);
    map.set(key, t);
  }
  return [...map.values()]
    .sort((a, b) => b.credits - a.credits || b.cost - a.cost || b.tokens - a.tokens)
    .slice(0, limit);
}

/** Sum a metric across events matching the filter. */
export function sumEvents(
  events: UsageEvent[],
  f?: Filter,
): { credits: number; cost: number; tokens: number; count: number } {
  let credits = 0;
  let cost = 0;
  let tokens = 0;
  let count = 0;
  for (const e of events) {
    if (!matchesFilter(e, f)) continue;
    credits += e.credits;
    cost += e.cost;
    tokens += tokensOf(e);
    count += 1;
  }
  return { credits, cost, tokens, count };
}
