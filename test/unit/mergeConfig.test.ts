import * as assert from 'assert';
import { mergeConfig } from '../../src/app/mergeConfig';

describe('mergeConfig', () => {
  it('falls back to defaults for negative numbers', () => {
    const out = mergeConfig({ monthlyBudget: -1, includedCredits: -5 });
    assert.equal(out.monthlyBudget, 0);
    assert.equal(out.includedCredits, 300);
  });

  it('falls back to defaults for missing fields', () => {
    const out = mergeConfig({});
    assert.equal(out.monthlyBudget, 0);
    assert.equal(out.includedCredits, 300);
  });

  it('preserves v2 fields when present', () => {
    const out = mergeConfig({
      version: 2,
      vars: { x: 1 },
      groups: [{ id: 'g', active: 'true' }],
      rules: [{ id: 'r', severity: 'warning', message: '', when: 'true' }],
      budget: { monthlyUsd: 50, includedCredits: 300 },
    });
    assert.equal(out.version, 2);
    assert.deepEqual(out.vars, { x: 1 });
    assert.equal(out.rules?.length, 1);
    assert.equal(out.budget?.monthlyUsd, 50);
  });
});
