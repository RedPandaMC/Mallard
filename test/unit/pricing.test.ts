import { strict as assert } from 'assert';
import {
  costForCredits,
  priceRequest,
  resolveMultiplier,
} from '../../src/model/pricing';

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

  it('computes cost from credits', () => {
    assert.equal(costForCredits(10, 0.04), 0.4);
    const priced = priceRequest('claude-opus-4', { pricePerCredit: 0.04, currency: 'USD' });
    assert.equal(priced.credits, 10);
    assert.ok(Math.abs(priced.cost - 0.4) < 1e-9);
  });
});
