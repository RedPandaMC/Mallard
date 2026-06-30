import * as assert from 'assert';
import { mergeConfig } from '../../src/extension/app/mergeConfig';

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

  it('accepts a boolean velocityEnabled', () => {
    const out = mergeConfig({ alerts: { velocityEnabled: true, velocityCreditsPerHour: 50 } });
    assert.equal(out.alerts.velocityEnabled, true);
    assert.equal(out.alerts.velocityCreditsPerHour, 50);
  });

  it('preserves branchBudgets when present', () => {
    const out = mergeConfig({ branchBudgets: { main: 200, 'feature/x': 500 } });
    assert.deepEqual(out.branchBudgets, { main: 200, 'feature/x': 500 });
  });

  it('omits branchBudgets when not present', () => {
    const out = mergeConfig({});
    assert.equal(out.branchBudgets, undefined);
  });

  it('preserves v2 fields when present', () => {
    const out = mergeConfig({
      version: 2,
      vars: { x: 1 },
      groups: [{ id: 'g', active: true as const }],
      rules: [{ id: 'r', severity: 'warning' as const, message: '', when: true as const }],
      budget: { monthlyUsd: 50, includedCredits: 300 },
    });
    assert.equal(out.version, 2);
    assert.deepEqual(out.vars, { x: 1 });
    assert.equal(out.rules?.length, 1);
    assert.equal(out.budget?.monthlyUsd, 50);
  });
});
