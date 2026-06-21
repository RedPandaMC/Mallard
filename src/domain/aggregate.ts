/**
 * Pure aggregation: turn a flat list of UsageEvents into per-granularity
 * buckets (with per-model breakdowns) and ranked top lists.
 */
import {
  Bucket,
  Filter,
  Granularity,
  GRANULARITIES,
  SankeyLink,
  SourceKind,
  Surface,
  TopEntry,
  UsageAggregate,
  UsageEvent,
} from './types';
import { bucketKey, nextBucketStart, startOf } from '../util/time';

export function tokensOf(e: UsageEvent): number {
  return (e.promptTokens ?? 0) + (e.completionTokens ?? 0);
}

export function matchesFilter(event: UsageEvent, filter?: Filter): boolean {
  if (!filter) return true;
  if (filter.range && (event.ts < filter.range.start || event.ts >= filter.range.end)) return false;
  if (filter.models?.length && !filter.models.includes(event.modelId)) return false;
  if (filter.surfaces?.length && !filter.surfaces.includes(event.surface)) return false;
  if (filter.repos?.length && !filter.repos.includes(event.repo ?? UNATTRIBUTED_REPO)) return false;
  if (filter.branches?.length && !filter.branches.includes(event.branch ?? '')) return false;
  if (filter.sources?.length && !filter.sources.includes(event.source)) return false;
  return true;
}

/** Key used for events that could not be attributed to a workspace repo. */
export const UNATTRIBUTED_REPO = 'unattributed';

function addTo(rec: Record<string, Bucket>, key: string, entry: UsageEvent, tokenCount: number): void {
  const bucket = rec[key] ?? (rec[key] = { credits: 0, cost: 0, tokens: 0 });
  bucket.credits += entry.credits;
  bucket.cost += entry.cost;
  bucket.tokens += tokenCount;
}

export function aggregateBy(
  events: readonly UsageEvent[],
  granularity: Granularity,
  filter?: Filter,
): UsageAggregate[] {
  const map = new Map<string, UsageAggregate>();
  for (const entry of events) {
    if (!matchesFilter(entry, filter)) continue;
    const key = bucketKey(entry.ts, granularity);
    let agg = map.get(key);
    if (!agg) {
      agg = {
        granularity,
        bucketKey: key,
        start: startOf(entry.ts, granularity),
        end: nextBucketStart(entry.ts, granularity),
        credits: 0,
        cost: 0,
        tokens: 0,
        byModel: {},
        eventCount: 0,
        estimated: false,
      };
      map.set(key, agg);
    }
    const tokenCount = tokensOf(entry);
    agg.credits += entry.credits;
    agg.cost += entry.cost;
    agg.tokens += tokenCount;
    agg.eventCount += 1;
    agg.estimated = agg.estimated || entry.estimated;
    addTo(agg.byModel, entry.modelId, entry, tokenCount);
  }
  return [...map.values()].sort((a, b) => a.start - b.start);
}

export function aggregateAll(
  events: readonly UsageEvent[],
  filter?: Filter,
): Record<Granularity, UsageAggregate[]> {
  const out = {} as Record<Granularity, UsageAggregate[]>;
  for (const granularity of GRANULARITIES) out[granularity] = aggregateBy(events, granularity, filter);
  return out;
}

export function topBy(
  events: readonly UsageEvent[],
  dimension: 'model' | 'surface' | 'repo',
  filter?: Filter,
  limit = 8,
): TopEntry[] {
  const map = new Map<string, TopEntry>();
  for (const entry of events) {
    if (!matchesFilter(entry, filter)) continue;
    const key =
      dimension === 'model'
        ? entry.modelId
        : dimension === 'surface'
          ? entry.surface
          : (entry.repo ?? UNATTRIBUTED_REPO);
    const topEntry = map.get(key) ?? { key, credits: 0, cost: 0, tokens: 0 };
    topEntry.credits += entry.credits;
    topEntry.cost += entry.cost;
    topEntry.tokens += tokensOf(entry);
    map.set(key, topEntry);
  }
  return [...map.values()]
    .sort((a, b) => b.credits - a.credits || b.cost - a.cost)
    .slice(0, limit);
}

/** Sum a metric across events matching the filter. */
export function sumEvents(
  events: readonly UsageEvent[],
  filter?: Filter,
): { credits: number; cost: number; tokens: number; count: number } {
  let credits = 0;
  let cost = 0;
  let tokens = 0;
  let count = 0;
  for (const entry of events) {
    if (!matchesFilter(entry, filter)) continue;
    credits += entry.credits;
    cost += entry.cost;
    tokens += tokensOf(entry);
    count += 1;
  }
  return { credits, cost, tokens, count };
}

/**
 * Build Sankey links for the model → surface flow chart.
 * Only includes links with value > 0.
 */
export function sankeyLinksFor(events: readonly UsageEvent[], filter?: Filter): SankeyLink[] {
  const map = new Map<string, number>();
  for (const entry of events) {
    if (!matchesFilter(entry, filter)) continue;
    if (entry.credits <= 0) continue;
    const key = `${entry.modelId}|||${entry.surface}`;
    map.set(key, (map.get(key) ?? 0) + entry.credits);
  }
  return [...map.entries()]
    .filter(([, v]) => v > 0)
    .map(([key, value]) => {
      const [source, target] = key.split('|||');
      return { source, target, value };
    })
    .filter((l): l is SankeyLink => l.source !== undefined && l.target !== undefined);
}

/** All distinct model IDs in the filtered event set. */
export function distinctModels(events: readonly UsageEvent[], filter?: Filter): string[] {
  const set = new Set<string>();
  for (const entry of events) {
    if (!matchesFilter(entry, filter)) continue;
    set.add(entry.modelId);
  }
  return [...set].sort();
}

/** All distinct repos in the filtered event set. */
export function distinctRepos(events: readonly UsageEvent[], filter?: Filter): string[] {
  const set = new Set<string>();
  for (const entry of events) {
    if (!matchesFilter(entry, filter)) continue;
    set.add(entry.repo ?? UNATTRIBUTED_REPO);
  }
  return [...set].sort();
}

/** All distinct surfaces in the filtered event set. */
export function distinctSurfaces(events: readonly UsageEvent[], filter?: Filter): Surface[] {
  const set = new Set<Surface>();
  for (const entry of events) {
    if (!matchesFilter(entry, filter)) continue;
    set.add(entry.surface);
  }
  const order: Surface[] = ['chat', 'inline', 'agent', 'edit', 'unknown'];
  return order.filter((surface) => set.has(surface));
}

/** All distinct source kinds in the filtered event set. */
export function distinctSources(events: readonly UsageEvent[], filter?: Filter): SourceKind[] {
  const set = new Set<SourceKind>();
  for (const entry of events) {
    if (!matchesFilter(entry, filter)) continue;
    set.add(entry.source);
  }
  const order: SourceKind[] = ['lm', 'local', 'github', 'claude-code'];
  return order.filter((s) => set.has(s));
}
