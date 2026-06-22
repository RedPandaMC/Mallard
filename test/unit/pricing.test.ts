import { strict as assert } from 'assert';
import {
  costForCredits,
  modelFamily,
  priceRequest,
  resolveMultiplier,
  PricingManifest,
} from '../../src/domain/pricing';

describe('pricing', () => {
  it('resolves known model multipliers (longest match wins)', () => {
    assert.equal(resolveMultiplier('gpt-4o'), 1);
    assert.equal(resolveMultiplier('gpt-4o-mini'), 0);
    assert.equal(resolveMultiplier('claude-opus-4'), 10);
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

  it('computes cost from credits', () => {
    assert.equal(costForCredits(10, 0.04), 0.4);
    const priced = priceRequest('claude-opus-4', { pricePerCredit: 0.04, currency: 'USD' });
    assert.equal(priced.credits, 10);
    assert.ok(Math.abs(priced.cost - 0.4) < 1e-9);
  });
});
