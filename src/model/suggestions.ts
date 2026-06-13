/**
 * Pure, testable model-switching suggestions.
 *
 * After 14+ days of data, analyse which premium models are used heavily for
 * low-value surfaces (inline completions) and suggest cheaper alternatives.
 */
import { PricingManifest, resolveMultiplier } from './pricing';
import { ModelSuggestion, Surface, UsageEvent } from './types';
import { DAY_MS, startOf } from '../util/time';

const MIN_DATA_DAYS = 14;

/** Return cheaper built-in alternatives for a given surface, if any. */
function cheaperAlternative(modelId: string, surface: Surface): string | null {
  const multiplier = resolveMultiplier(modelId, undefined, undefined);
  if (multiplier === 0) return null; // already free-tier

  if (surface === 'inline') {
    // For inline completions, zero-multiplier models work well.
    if (modelId.includes('gpt')) return 'gpt-4.1-mini';
    if (modelId.includes('claude')) return 'claude-haiku-4-5';
    if (modelId.includes('gemini')) return 'gemini-2.0-flash';
  }
  return null;
}

export function computeSuggestions(
  events: UsageEvent[],
  manifest: PricingManifest,
  now = Date.now(),
): ModelSuggestion[] {
  if (events.length === 0) return [];

  // Require at least MIN_DATA_DAYS of history.
  const minTs = events.reduce((m, e) => Math.min(m, e.ts), Infinity);
  const daysCovered = (now - minTs) / DAY_MS;
  if (daysCovered < MIN_DATA_DAYS) return [];

  // Monthly projection: scale last 30 days of data.
  const windowStart = startOf(now - 30 * DAY_MS, 'day');
  const recent = events.filter((e) => e.ts >= windowStart);

  // Aggregate cost per (model, surface).
  const totals = new Map<string, { credits: number; cost: number }>();
  for (const e of recent) {
    const key = `${e.modelId}::${e.surface}`;
    const cur = totals.get(key) ?? { credits: 0, cost: 0 };
    cur.credits += e.credits;
    cur.cost += e.cost;
    totals.set(key, cur);
  }

  const suggestions: ModelSuggestion[] = [];
  for (const [key, { credits, cost }] of totals) {
    const sep = key.indexOf('::');
    const modelId = key.slice(0, sep);
    const surface = key.slice(sep + 2) as Surface;
    const alt = cheaperAlternative(modelId, surface);
    if (!alt) continue;

    const altMultiplier = resolveMultiplier(alt, undefined, manifest);
    const curMultiplier = resolveMultiplier(modelId, undefined, manifest);
    if (altMultiplier >= curMultiplier) continue;

    const savingRatio = 1 - altMultiplier / curMultiplier;
    const estimatedMonthlySaving = cost * savingRatio;
    if (estimatedMonthlySaving < 0.5) continue; // skip trivial savings

    suggestions.push({
      currentModel: modelId,
      suggestedModel: alt,
      surface,
      estimatedMonthlySaving,
      basis: `Based on ${Math.round(credits)} credits over the last 30 days`,
    });
  }

  return suggestions.sort((a, b) => b.estimatedMonthlySaving - a.estimatedMonthlySaving);
}
