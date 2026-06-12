/**
 * Model → credit (premium-request) weight and cost helpers.
 *
 * Copilot bills "premium requests": one request costs `multiplier` credits
 * depending on the model. These default multipliers approximate GitHub's
 * published model multipliers and are fully overridable via settings
 * (`weevil.tokenPricing`) so the extension stays correct as pricing evolves.
 */

export interface PricingConfig {
  pricePerCredit: number;
  currency: string;
  /** Optional per-model multiplier overrides, matched by case-insensitive substring. */
  modelMultipliers?: Record<string, number>;
}

/** Default premium-request multipliers, keyed by a model-id substring. */
export const DEFAULT_MULTIPLIERS: Record<string, number> = {
  'gpt-4o-mini': 0,
  'gpt-4.1': 0,
  'gpt-4o': 1,
  'gpt-5': 1,
  'o4-mini': 0.33,
  'o3-mini': 0.33,
  o3: 10,
  'claude-3.5-sonnet': 1,
  'claude-3.7-sonnet': 1.25,
  'claude-sonnet-4': 1,
  'claude-opus-4': 10,
  'claude-opus': 10,
  'claude-haiku': 0.33,
  'gemini-2.0-flash': 0.25,
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

/** Resolve the credit multiplier for a model id (overrides win, then longest match). */
export function resolveMultiplier(modelId: string, overrides?: Record<string, number>): number {
  const id = (modelId || '').toLowerCase();
  if (overrides) {
    const keys = Object.keys(overrides).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (id.includes(key.toLowerCase())) return overrides[key];
    }
  }
  const keys = Object.keys(DEFAULT_MULTIPLIERS)
    .filter((k) => k !== 'unknown')
    .sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (id.includes(key)) return DEFAULT_MULTIPLIERS[key];
  }
  return DEFAULT_MULTIPLIERS.unknown;
}

export function costForCredits(credits: number, pricePerCredit: number): number {
  return credits * pricePerCredit;
}

/** Compute credits + cost for a single request of `modelId`. */
export function priceRequest(
  modelId: string,
  cfg: PricingConfig,
): { credits: number; cost: number } {
  const credits = resolveMultiplier(modelId, cfg.modelMultipliers);
  return { credits, cost: costForCredits(credits, cfg.pricePerCredit) };
}
