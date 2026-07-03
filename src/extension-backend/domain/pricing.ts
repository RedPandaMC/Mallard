/* c8 ignore next */
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

/** USD per token for one model, from OpenRouter/LiteLLM. */
export interface ModelTokenPrice {
  input: number;
  output: number;
  /** Reading from prompt cache. Falls back to `input` when absent. */
  cacheRead?: number;
  /** Writing to prompt cache. Falls back to `input` when absent. */
  cacheWrite?: number;
  /** Reasoning/thinking tokens. Falls back to `output` when absent. */
  thinking?: number;
}

/** Model-id substring → per-token USD prices. */
export type TokenPrices = Record<string, ModelTokenPrice>;

export interface PricingConfig {
  pricePerCredit: number;
  currency: string;
  manifest?: PricingManifest;
}

/**
 * Default premium-request multipliers, keyed by a model-id substring.
 * Mirrors media/pricing-manifest.json (GitHub's published multiplier table,
 * last synced 2026-07-03); the manifest is the refreshed source of truth and
 * this constant is only the compiled-in fallback.
 */
export const DEFAULT_MULTIPLIERS: Record<string, number> = {
  'gpt-4o-mini': 0.33,
  'gpt-4.1-mini': 0,
  'gpt-4.1-nano': 0,
  'gpt-4.1': 0,
  'gpt-4o': 0.33,
  'gpt-5.1-codex-mini': 0.33,
  'gpt-5.1-codex-max': 3,
  'gpt-5.1-codex': 3,
  'gpt-5.1': 3,
  'gpt-5.3-codex': 6,
  'gpt-5.4-mini': 6,
  'gpt-5.4': 6,
  'gpt-5.5': 57,
  'gpt-5-mini': 0.33,
  'gpt-5': 1,
  'o4-mini': 0.33,
  'o3-mini': 0.33,
  o3: 10,
  'claude-3.5-haiku': 0.33,
  'claude-haiku-4-5': 0.33,
  'claude-haiku': 0.33,
  'claude-3.5-sonnet': 1,
  'claude-3.7-sonnet': 1.25,
  'claude-sonnet-4-5': 6,
  'claude-sonnet-4-6': 9,
  'claude-sonnet-4': 1,
  'claude-opus-4-5': 15,
  'claude-opus-4-6': 27,
  'claude-opus-4-7': 27,
  'claude-opus-4-8': 27,
  'claude-opus-4': 10,
  'claude-opus': 15,
  'gemini-2.0-flash': 0.25,
  'gemini-2.5-flash': 0.25,
  'gemini-2.5-pro': 1,
  'gemini-3-flash': 0.33,
  'gemini-3.5-flash': 14,
  'gemini-3.1-pro': 6,
  'gemini-3-pro': 6,
  'raptor-mini': 0.33,
  'mai-code-1-flash': 0.33,
  unknown: 1,
};

/** Coarse family label for display/grouping. */
/* c8 ignore next */
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
  /* c8 ignore next */
  return source['unknown'] ?? DEFAULT_MULTIPLIERS['unknown']!;
}

export function costForCredits(credits: number, pricePerCredit: number): number {
  return credits * pricePerCredit;
}

/** Longest matching key in `prices` whose id-substring appears in `modelId`. */
function resolveTokenPrice(
  modelId: string,
  prices: TokenPrices,
): ModelTokenPrice | undefined {
  const id = (modelId || '').toLowerCase();
  const keys = Object.keys(prices).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (id.includes(key.toLowerCase())) return prices[key];
  }
  return undefined;
}

export interface TokenUsage {
  prompt?: number;
  completion?: number;
  cacheCreation?: number;
  cacheRead?: number;
  thinking?: number;
}

export interface TokenCost {
  total: number;
  byCategory: {
    input?: number;
    output?: number;
    cache_creation?: number;
    cache_read?: number;
    thinking?: number;
  };
}

/**
 * Exact per-token cost for a request, when a token price is known for the
 * model. Returns undefined when the model has no token price or the usage
 * carries no tokens — callers fall back to the credit-multiplier estimate.
 * Thinking tokens use the dedicated reasoning rate when the feed provides
 * one, else the output rate.
 */
export function priceTokens(
  modelId: string,
  usage: TokenUsage,
  prices: TokenPrices | undefined,
): TokenCost | undefined {
  if (!prices) return undefined;
  const p = resolveTokenPrice(modelId, prices);
  if (!p) return undefined;

  const cacheRead = p.cacheRead ?? p.input;
  const cacheWrite = p.cacheWrite ?? p.input;
  const thinking = p.thinking ?? p.output;
  const byCategory: TokenCost['byCategory'] = {};
  if (usage.prompt) byCategory.input = usage.prompt * p.input;
  if (usage.completion) byCategory.output = usage.completion * p.output;
  if (usage.cacheCreation) byCategory.cache_creation = usage.cacheCreation * cacheWrite;
  if (usage.cacheRead) byCategory.cache_read = usage.cacheRead * cacheRead;
  if (usage.thinking) byCategory.thinking = usage.thinking * thinking;

  const total = Object.values(byCategory).reduce((a, v) => a + v, 0);
  if (total <= 0) return undefined;
  return { total, byCategory };
}

/** Compute credits + cost for a single request of `modelId`. */
/* c8 ignore next */
export function priceRequest(
  modelId: string,
  cfg: PricingConfig,
): { credits: number; cost: number } {
  const credits = resolveMultiplier(modelId, undefined, cfg.manifest);
  return { credits, cost: costForCredits(credits, cfg.pricePerCredit) };
}
