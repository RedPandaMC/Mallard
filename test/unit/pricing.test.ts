import { strict as assert } from 'assert';
import {
  costForCredits,
  modelFamily,
  priceRequest,
  priceTokens,
  resolveMultiplier,
  PricingManifest,
  TokenPrices,
} from '../../src/extension-backend/domain/pricing';
import {
  parseLiteLlmPrices,
  parseOpenRouterModels,
} from '../../src/extension-backend/pricing/PricingService';

describe('pricing', () => {
  it('resolves known model multipliers (longest match wins)', () => {
    // Values from GitHub's published multiplier table (synced 2026-07-03)
    assert.equal(resolveMultiplier('gpt-4o'), 0.33);
    assert.equal(resolveMultiplier('gpt-4o-mini'), 0.33);
    assert.equal(resolveMultiplier('gpt-5.5'), 57);
    assert.equal(resolveMultiplier('claude-opus-4'), 10);
    assert.equal(resolveMultiplier('claude-opus-4-8'), 27);
    assert.equal(resolveMultiplier('claude-sonnet-4-5'), 6);
    assert.equal(resolveMultiplier('o3'), 10);
    assert.equal(resolveMultiplier('o4-mini'), 0.33);
  });

  it('falls back to 1 for unknown models', () => {
    assert.equal(resolveMultiplier('some-random-model'), 1);
    assert.equal(resolveMultiplier(''), 1);
  });

  it('honours overrides ahead of defaults', () => {
    assert.equal(resolveMultiplier('gpt-4o', { 'gpt-4o': 2.5 }), 2.5);
  });

  it('uses manifest models when provided', () => {
    const manifest: PricingManifest = {
      version: 1,
      pricePerCredit: 0.05,
      updatedAt: '2025-01-01',
      models: { 'future-model': 3, 'gpt-4o': 2, unknown: 1 },
    };
    assert.equal(resolveMultiplier('future-model', undefined, manifest), 3);
    assert.equal(resolveMultiplier('gpt-4o', undefined, manifest), 2);
  });

  it('modelFamily returns the correct family label', () => {
    assert.equal(modelFamily('gpt-4o'), 'gpt');
    assert.equal(modelFamily('claude-sonnet-4'), 'claude');
    assert.equal(modelFamily('o3'), 'o-series');
    assert.equal(modelFamily('gemini-2.5-flash'), 'gemini');
    assert.equal(modelFamily('llama-3'), 'other');
    assert.equal(modelFamily(''), 'other'); // empty string fallback
  });

  it('resolveMultiplier passes through overrides when no key matches', () => {
    assert.equal(resolveMultiplier('llama-3', { 'gpt-4o': 2 }), 1); // override present but no match
  });

  it('resolveMultiplier sort comparator with 2+ override keys (longest match wins)', () => {
    assert.equal(resolveMultiplier('gpt-4o', { 'gpt': 5, 'gpt-4o': 2 }), 2); // longer key wins
    assert.equal(resolveMultiplier('gpt-4', { 'gpt': 5, 'gpt-4o': 2 }), 5); // shorter match wins for 'gpt-4'
  });

  it('override key comparison is case-insensitive (key is lowercased before matching)', () => {
    assert.equal(resolveMultiplier('gpt-4o', { 'GPT-4O': 2.5 }), 2.5);
  });

  it('negative multiplier from override produces negative credits (document behavior)', () => {
    const credits = resolveMultiplier('gpt-4o', { 'gpt-4o': -2 });
    assert.equal(credits, -2);
    assert.equal(costForCredits(-2, 0.04), -0.08);
  });

  it('priceRequest with pricePerCredit=0 returns zero cost', () => {
    const result = priceRequest('gpt-4o', { pricePerCredit: 0, currency: 'USD' });
    assert.equal(result.credits, 0.33);
    assert.equal(result.cost, 0);
  });

  it('computes cost from credits', () => {
    assert.equal(costForCredits(10, 0.04), 0.4);
    const priced = priceRequest('claude-opus-4', { pricePerCredit: 0.04, currency: 'USD' });
    assert.equal(priced.credits, 10);
    assert.ok(Math.abs(priced.cost - 0.4) < 1e-9);
  });
});

describe('priceTokens — exact per-token costing', () => {
  const prices: TokenPrices = {
    'claude-sonnet-4-5': {
      input: 3e-6,
      output: 15e-6,
      cacheRead: 0.3e-6,
      cacheWrite: 3.75e-6,
    },
    'gpt-4o': { input: 2.5e-6, output: 10e-6 },
    'thinker-1': { input: 1e-6, output: 4e-6, thinking: 2e-6 },
  };

  it('prices every token category with its own rate', () => {
    const r = priceTokens(
      'claude-sonnet-4-5',
      { prompt: 1000, completion: 500, cacheCreation: 200, cacheRead: 4000 },
      prices,
    )!;
    assert.ok(Math.abs(r.byCategory.input! - 0.003) < 1e-12);
    assert.ok(Math.abs(r.byCategory.output! - 0.0075) < 1e-12);
    assert.ok(Math.abs(r.byCategory.cache_creation! - 0.00075) < 1e-12);
    assert.ok(Math.abs(r.byCategory.cache_read! - 0.0000012 * 1000) < 1e-12);
    const sum = Object.values(r.byCategory).reduce((a, v) => a + v, 0);
    assert.ok(Math.abs(r.total - sum) < 1e-12);
  });

  it('thinking tokens use the dedicated reasoning rate when present', () => {
    const r = priceTokens('thinker-1', { thinking: 1000 }, prices)!;
    assert.ok(Math.abs(r.byCategory.thinking! - 0.002) < 1e-12);
  });

  it('thinking tokens fall back to the output rate otherwise', () => {
    const r = priceTokens('gpt-4o', { completion: 100, thinking: 100 }, prices)!;
    assert.ok(Math.abs(r.byCategory.thinking! - r.byCategory.output!) < 1e-12);
  });

  it('cache rates fall back to the input rate when the feed has none', () => {
    const r = priceTokens('gpt-4o', { cacheRead: 100, cacheCreation: 100 }, prices)!;
    assert.ok(Math.abs(r.byCategory.cache_read! - 100 * 2.5e-6) < 1e-12);
    assert.ok(Math.abs(r.byCategory.cache_creation! - 100 * 2.5e-6) < 1e-12);
  });

  it('returns undefined for unknown models, empty usage, or no price feed', () => {
    assert.equal(priceTokens('mystery-model', { prompt: 10 }, prices), undefined);
    assert.equal(priceTokens('gpt-4o', {}, prices), undefined);
    assert.equal(priceTokens('gpt-4o', { prompt: 10 }, undefined), undefined);
  });

  it('matches the longest model-id substring', () => {
    const p: TokenPrices = {
      'gpt-4o': { input: 1e-6, output: 1e-6 },
      'gpt-4o-mini': { input: 5e-7, output: 5e-7 },
    };
    const r = priceTokens('gpt-4o-mini-2026', { prompt: 1_000_000 }, p)!;
    assert.ok(Math.abs(r.byCategory.input! - 0.5) < 1e-12);
  });
});

describe('token price feed parsers', () => {
  it('parses the OpenRouter models payload', () => {
    const prices = parseOpenRouterModels({
      data: [
        {
          id: 'anthropic/claude-sonnet-4-5',
          pricing: {
            prompt: '0.000003',
            completion: '0.000015',
            input_cache_read: '0.0000003',
            input_cache_write: '0.00000375',
            internal_reasoning: '0.00002',
          },
        },
        { id: 'openai/gpt-4o', pricing: { prompt: '0.0000025', completion: '0.00001' } },
        { id: 'some/irrelevant-model', pricing: { prompt: '0.001', completion: '0.001' } },
        { id: 'broken/entry', pricing: { prompt: 'free', completion: null } },
      ],
    });
    assert.deepEqual(Object.keys(prices).sort(), ['claude-sonnet-4-5', 'gpt-4o']);
    assert.equal(prices['claude-sonnet-4-5']!.input, 3e-6);
    assert.equal(prices['claude-sonnet-4-5']!.cacheRead, 3e-7);
    assert.equal(prices['claude-sonnet-4-5']!.thinking, 2e-5);
    assert.equal(prices['gpt-4o']!.cacheRead, undefined);
  });

  it('parses the LiteLLM price sheet, first provider alias winning', () => {
    const prices = parseLiteLlmPrices({
      'claude-sonnet-4-5': {
        input_cost_per_token: 3e-6,
        output_cost_per_token: 15e-6,
        cache_read_input_token_cost: 3e-7,
        cache_creation_input_token_cost: 3.75e-6,
      },
      'anthropic/claude-sonnet-4-5': {
        input_cost_per_token: 999,
        output_cost_per_token: 999,
      },
      'sample_spec': { input_cost_per_token: 0, output_cost_per_token: 0 },
      'unrelated-embedding-model': { input_cost_per_token: 1e-7 },
    });
    assert.deepEqual(Object.keys(prices), ['claude-sonnet-4-5']);
    assert.equal(prices['claude-sonnet-4-5']!.input, 3e-6);
    assert.equal(prices['claude-sonnet-4-5']!.cacheWrite, 3.75e-6);
  });

  it('returns empty maps for malformed payloads', () => {
    assert.deepEqual(parseOpenRouterModels(null), {});
    assert.deepEqual(parseOpenRouterModels({ data: 'nope' }), {});
    assert.deepEqual(parseLiteLlmPrices(null), {});
    assert.deepEqual(parseLiteLlmPrices([1, 2, 3]), {});
  });
});
