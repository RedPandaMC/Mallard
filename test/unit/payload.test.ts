import { strict as assert } from 'assert';
import { buildMetricPayload } from '../../src/export/payload';
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

describe('buildMetricPayload', () => {
  it('produces all expected MetricPayload keys', () => {
    const s = buildSnapshot([makeEvent({ ts: Date.now() - 1000, modelId: 'gpt-4o' })], opts());
    const p = buildMetricPayload(s);
    const EXPECTED = [
      'ts', 'model_dist', 'surface_dist', 'input_cost_ratio',
      'credits_velocity_per_hour', 'mtd_budget_pct', 'repo_count',
      'peak_usage_hour', 'daily_credit_variance', 'model_count',
      'surface_concentration', 'estimated_event_ratio', 'forecast_basis',
      'budget_trend', 'token_per_credit', 'forecast_low', 'forecast_high',
    ];
    for (const key of EXPECTED) {
      assert.ok(key in p, `missing key: ${key}`);
    }
  });

  it('ts is an ISO string', () => {
    const s = buildSnapshot([makeEvent({ ts: Date.now() - 1000 })], opts());
    const p = buildMetricPayload(s);
    assert.ok(!isNaN(Date.parse(p.ts)), 'ts should parse as a valid date');
  });

  it('model_dist fractions sum to ≤1', () => {
    const now = Date.now();
    const events = [
      makeEvent({ ts: now - 1000, modelId: 'gpt-4o', credits: 3 }),
      makeEvent({ ts: now - 2000, modelId: 'claude-3.5-sonnet', credits: 1 }),
    ];
    const s = buildSnapshot(events, opts({ now }));
    const p = buildMetricPayload(s);
    const total = Object.values(p.model_dist).reduce((a, x) => a + x, 0);
    assert.ok(total <= 1.0001, `model_dist sums to ${total}`);
  });

  it('returns zero input_cost_ratio when category data is unavailable', () => {
    const s = buildSnapshot([makeEvent({ ts: Date.now() - 1000, modelId: 'gpt-4o' })], opts());
    const p = buildMetricPayload(s);
    assert.equal(p.input_cost_ratio, 0);
  });

  it('repo_count matches allRepos length', () => {
    const now = Date.now();
    const events = [
      makeEvent({ ts: now - 1000, modelId: 'gpt-4o', repo: 'org/a' }),
      makeEvent({ ts: now - 2000, modelId: 'gpt-4o', repo: 'org/b' }),
    ];
    const s = buildSnapshot(events, opts({ now }));
    const p = buildMetricPayload(s);
    assert.equal(p.repo_count, 2);
  });
});
