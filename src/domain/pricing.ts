/**
 * Model → credit (premium-request) weight and cost helpers.
 *
 * GitHub bills "premium requests": one request costs `multiplier` credits
 * depending on the model. Default multipliers come from the bundled
 * pricing manifest and are refreshed daily — settings are only needed
 * for non-standard enterprise plans.
 */

export interface PricingManifest {
  version: number;
  pricePerCredit: number;
  updatedAt: string;
  models: Record<string, number>;
}

export interface PricingConfig {
  pricePerCredit: number;
  currency: string;
  manifest?: PricingManifest;
}

/** Default premium-request multipliers, keyed by a model-id substring. */
export const DEFAULT_MULTIPLIERS: Record<string, number> = {
  'gpt-4o-mini': 0,
  'gpt-4.1-mini': 0,
  'gpt-4.1-nano': 0,
  'gpt-4.1': 0,
  'gpt-4o': 1,
  'gpt-5': 1,
  'o4-mini': 0.33,
  'o3-mini': 0.33,
  o3: 10,
  'claude-3.5-haiku': 0.33,
  'claude-haiku': 0.33,
  'claude-3.5-sonnet': 1,
  'claude-3.7-sonnet': 1.25,
  'claude-sonnet-4': 1,
  'claude-opus-4': 10,
  'claude-opus': 10,
  'gemini-2.0-flash': 0.25,
  'gemini-2.5-flash': 0.25,
  'gemini-2.5-pro': 1,
  unknown: 1,
};

/** Coarse family label for display/grouping. */
export function modelFamily(modelId: string): string {
  const id = (modelId || '').toLowerCase();
  if (id.includes('gpt')) return 'gpt';
  if (id.includes('claude')) return 'claude';
  if (id.startsWith('o') && /o\d/.test(id)) return 'o-series';
  if (id.includes('gemini')) return 'gemini';
  return 'other';
}

/**
 * Resolve the credit multiplier for a model id.
 * Priority: overrides → manifest → defaults → 1 (unknown).
 */
export function resolveMultiplier(
  modelId: string,
  overrides?: Record<string, number>,
  manifest?: PricingManifest,
): number {
  const id = (modelId || '').toLowerCase();

  if (overrides) {
    const keys = Object.keys(overrides).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (id.includes(key.toLowerCase())) return overrides[key]!;
    }
  }

  const source = manifest?.models ?? DEFAULT_MULTIPLIERS;
  const keys = Object.keys(source)
    .filter((k) => k !== 'unknown')
    .sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (id.includes(key)) return source[key]!;
  }
  return source['unknown'] ?? DEFAULT_MULTIPLIERS['unknown']!;
}

export function costForCredits(credits: number, pricePerCredit: number): number {
  return credits * pricePerCredit;
}

/** Compute credits + cost for a single request of `modelId`. */
export function priceRequest(
  modelId: string,
  cfg: PricingConfig,
): { credits: number; cost: number } {
  const credits = resolveMultiplier(modelId, undefined, cfg.manifest);
  return { credits, cost: costForCredits(credits, cfg.pricePerCredit) };
}
