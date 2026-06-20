import { strict as assert } from 'assert';
import { vectorize } from '../../src/export/vectorize';
import { buildSnapshot, SnapshotOptions } from '../../src/domain/snapshot';
import { makeEvent } from './helpers';

function opts(over: Partial<SnapshotOptions> = {}): SnapshotOptions {
  return {
    now: Date.now(),
    currency: 'USD',
    pricePerCredit: 0.04,
    monthlyBudget: null,
    includedCredits: 300,
    filter: {},
    source: 'local',
    status: { kind: 'ok' },
    authStatus: 'signed-out',
    ...over,
  };
}

describe('vectorize', () => {
  it('produces the expected keys', () => {
    const s = buildSnapshot([makeEvent({ ts: Date.now() - 1000, modelId: 'gpt-4o' })], opts());
    const v = vectorize(s);
    assert.ok('ts' in v);
    assert.ok('model_dist' in v);
    assert.ok('surface_dist' in v);
    assert.ok('input_cost_ratio' in v);
    assert.ok('credits_velocity_per_hour' in v);
    assert.ok('mtd_budget_pct' in v);
    assert.ok('repo_count' in v);
  });

  it('ts is an ISO string', () => {
    const s = buildSnapshot([makeEvent({ ts: Date.now() - 1000 })], opts());
    const v = vectorize(s);
    assert.ok(!isNaN(Date.parse(v.ts)), 'ts should parse as a valid date');
  });

  it('model_dist fractions sum to ≤1', () => {
    const now = Date.now();
    const events = [
      makeEvent({ ts: now - 1000, modelId: 'gpt-4o', credits: 3 }),
      makeEvent({ ts: now - 2000, modelId: 'claude-3.5-sonnet', credits: 1 }),
    ];
    const s = buildSnapshot(events, opts({ now }));
    const v = vectorize(s);
    const total = Object.values(v.model_dist).reduce((a, x) => a + x, 0);
    assert.ok(total <= 1.0001, `model_dist sums to ${total}`);
  });

  it('returns zero input_cost_ratio when category data is unavailable', () => {
    const s = buildSnapshot([makeEvent({ ts: Date.now() - 1000, modelId: 'gpt-4o' })], opts());
    const v = vectorize(s);
    // Events without costByCategory → category unavailable → ratio 0
    assert.equal(v.input_cost_ratio, 0);
  });

  it('repo_count matches allRepos length', () => {
    const now = Date.now();
    const events = [
      makeEvent({ ts: now - 1000, modelId: 'gpt-4o', repo: 'org/a' }),
      makeEvent({ ts: now - 2000, modelId: 'gpt-4o', repo: 'org/b' }),
    ];
    const s = buildSnapshot(events, opts({ now }));
    const v = vectorize(s);
    assert.equal(v.repo_count, 2);
  });
});
