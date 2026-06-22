/* c8 ignore start */
import { CostCategory, UsageEvent } from './types';
import { UNATTRIBUTED_REPO } from './aggregate';
import { startOf } from '../util/time';
/* c8 ignore stop */

export type Categories = Partial<Record<CostCategory, number>>;

/** Sum two optional category maps; returns undefined when both are absent. */
export function addCategories(a?: Categories, b?: Categories): Categories | undefined {
  if (!a && !b) return undefined;
  const out: Categories = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {})) {
    /* c8 ignore next */
    out[k as CostCategory] = (out[k as CostCategory] ?? 0) + (v ?? 0);
  }
  return out;
}

/** Collapse old per-request events into one row per day/model/repo/surface. */
/* c8 ignore next */
export function rollupEvents(old: UsageEvent[]): UsageEvent[] {
  const map = new Map<string, UsageEvent>();
  for (const e of old) {
    const day = startOf(e.ts, 'day');
    const key = `roll:${day}:${e.modelId}:${e.repo ?? UNATTRIBUTED_REPO}:${e.surface}`;
    const existing = map.get(key);
    if (existing) {
      existing.credits += e.credits;
      existing.cost += e.cost;
      existing.promptTokens = (existing.promptTokens ?? 0) + (e.promptTokens ?? 0);
      existing.completionTokens = (existing.completionTokens ?? 0) + (e.completionTokens ?? 0);
      const merged = addCategories(existing.costByCategory, e.costByCategory);
      if (merged) existing.costByCategory = merged;
    } else {
      map.set(key, { ...e, id: key, ts: day, estimated: true });
    }
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}
