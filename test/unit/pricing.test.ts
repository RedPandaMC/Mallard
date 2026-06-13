import { strict as assert } from 'assert';
import {
  costForCredits,
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

  it('computes cost from credits', () => {
    assert.equal(costForCredits(10, 0.04), 0.4);
    const priced = priceRequest('claude-opus-4', { pricePerCredit: 0.04, currency: 'USD' });
    assert.equal(priced.credits, 10);
    assert.ok(Math.abs(priced.cost - 0.4) < 1e-9);
  });
});
