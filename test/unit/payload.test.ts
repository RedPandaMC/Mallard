import { strict as assert } from 'assert';
import { buildMetricPayload } from '../../src/extension-backend/export/payload';
import { buildSnapshot, SnapshotOptions } from '../../src/extension-backend/domain/snapshot';
import { UsageSnapshot } from '../../src/extension-backend/domain/types';
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
      'schema_version', 'instance_id',
      'ts', 'mtd_credits', 'mtd_cost_usd', 'today_credits', 'today_cost_usd',
      'active_models', 'top_model',
      'model_dist', 'surface_dist', 'cost_dist', 'input_cost_ratio',
      'credits_velocity_per_hour', 'mtd_budget_pct', 'repo_count',
      'peak_usage_hour', 'daily_credit_variance', 'model_count',
      'surface_concentration', 'estimated_event_ratio', 'forecast_basis',
      'budget_trend', 'token_per_credit', 'forecast_low', 'forecast_high',
      'source_connector',
    ];
    for (const key of EXPECTED) {
      assert.ok(key in p, `missing key: ${key}`);
    }
  });

  it('schema_version is always 2', () => {
    const s = buildSnapshot([makeEvent({ ts: Date.now() - 1000 })], opts());
    assert.equal(buildMetricPayload(s).schema_version, 2);
  });

  it('instance_id is a stable 64-char hex hash', () => {
    const s = buildSnapshot([makeEvent({ ts: Date.now() - 1000 })], opts());
    const p1 = buildMetricPayload(s);
    const p2 = buildMetricPayload(s);
    assert.match(p1.instance_id, /^[0-9a-f]{64}$/);
    assert.equal(p1.instance_id, p2.instance_id);
  });

  it('top_model is null when there are no events', () => {
    const s = buildSnapshot([], opts());
    assert.equal(buildMetricPayload(s).top_model, null);
  });

  it('top_model and active_models reflect the snapshot', () => {
    const now = Date.now();
    const events = [
      makeEvent({ ts: now - 1000, modelId: 'gpt-4o', credits: 3 }),
      makeEvent({ ts: now - 2000, modelId: 'claude-3.5-sonnet', credits: 1 }),
    ];
    const s = buildSnapshot(events, opts({ now }));
    const p = buildMetricPayload(s);
    assert.equal(p.top_model, 'gpt-4o');
    assert.ok(p.active_models.includes('gpt-4o'));
    assert.ok(p.active_models.includes('claude-3.5-sonnet'));
  });

  it('mtd_credits/today_credits mirror the snapshot budget and today totals', () => {
    const now = Date.now();
    const s = buildSnapshot([makeEvent({ ts: now - 1000, credits: 5, cost: 0.2 })], opts({ now }));
    const p = buildMetricPayload(s);
    assert.equal(p.mtd_credits, s.budget.usedCredits);
    assert.equal(p.mtd_cost_usd, s.budget.usedCost);
    assert.equal(p.today_credits, s.today.credits);
    assert.equal(p.today_cost_usd, s.today.cost);
  });

  it('cost_dist fractions sum to ≤1', () => {
    const now = Date.now();
    const events = [
      makeEvent({ ts: now - 1000, credits: 1, cost: 0.1, costByCategory: { input: 0.06, output: 0.04 } }),
    ];
    const s = buildSnapshot(events, opts({ now }));
    const p = buildMetricPayload(s);
    const total = Object.values(p.cost_dist).reduce((a, x) => a + x, 0);
    assert.ok(total <= 1.0001, `cost_dist sums to ${total}`);
  });

  it('source_connector is "none" for empty snapshot', () => {
    const s = buildSnapshot([], opts());
    assert.equal(buildMetricPayload(s).source_connector, 'none');
  });

  it('source_connector is "local" for local-only events', () => {
    const now = Date.now();
    const s = buildSnapshot([makeEvent({ ts: now - 1000, source: 'local' })], opts({ now }));
    assert.equal(buildMetricPayload(s).source_connector, 'local');
  });

  it('source_connector is "claude-code" for claude-code-only events', () => {
    const now = Date.now();
    const s = buildSnapshot([makeEvent({ ts: now - 1000, source: 'claude-code' })], opts({ now }));
    assert.equal(buildMetricPayload(s).source_connector, 'claude-code');
  });

  it('ts is a unix epoch milliseconds number matching generatedAt', () => {
    const s = buildSnapshot([makeEvent({ ts: Date.now() - 1000 })], opts());
    const p = buildMetricPayload(s);
    assert.equal(typeof p.ts, 'number');
    assert.equal(p.ts, s.generatedAt);
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

  it('budget_trend is 1 when projected daily pace exceeds recent average', () => {
    const now = Date.now();
    const zeroPoints = new Array(23).fill(null).map((_, i) => ({ date: `01-0${(i % 9) + 1}`, credits: 2, cost: 0.08, colorIndex: 0 as const }));
    const recentPoints = new Array(7).fill(null).map((_, i) => ({ date: `06-${String(i + 1).padStart(2, '0')}`, credits: 2, cost: 0.08, colorIndex: 0 as const }));
    const snap = {
      generatedAt: now,
      source: 'local' as const,
      topModels: [],
      sankeyLinks: [],
      chartData: {
        categoryBreakdown: { available: false as const, categories: [], costs: [], tokens: [] },
        hourlyTimeline: { hours: new Array(24).fill(0) as number[], peakHour: 0 },
        dailyBars: { points: [...zeroPoints, ...recentPoints], budgetLine: 3, projectedLine: 20 },
        modelBreakdown: { labels: [], credits: [], costs: [], tokens: [], cheapestEquivalentCosts: [] },
        heatmap: { cells: [], max: 0 },
      },
      allModels: [],
      allSurfaces: [],
      allSources: [],
      allRepos: [],
      byRepo: [],
      budget: { monthly: null, includedCredits: 90, usedCredits: 0, usedCost: 0, percentOfBudget: 0, percentOfIncluded: 0, projectedOverage: null, pace: 'no-budget' as const },
      forecast: { basis: 'linear' as const, projectedCredits: 600, projectedCost: 24, low: 500, high: 700, granularity: 'month' as const, asOf: now },
      today: { credits: 0, cost: 0, tokens: 0 },
      filter: {},
      currency: 'USD',
      pricePerCredit: 0.04,
      status: { kind: 'ok' as const },
      authStatus: 'signed-out' as const,
      isIncremental: false,
      currentBranchCredits: 0,
      range: { start: now - 30 * 86400000, end: now },
    } as unknown as UsageSnapshot;
    const p = buildMetricPayload(snap);
    assert.equal(p.budget_trend, 1);
  });

  it('budget_trend is -1 when projected daily pace is below recent average', () => {
    const now = Date.now();
    const zeroPoints = new Array(23).fill(null).map((_, i) => ({ date: `01-0${(i % 9) + 1}`, credits: 2, cost: 0.08, colorIndex: 0 as const }));
    const recentPoints = new Array(7).fill(null).map((_, i) => ({ date: `06-${String(i + 1).padStart(2, '0')}`, credits: 20, cost: 0.8, colorIndex: 2 as const }));
    const snap = {
      generatedAt: now,
      source: 'local' as const,
      topModels: [],
      sankeyLinks: [],
      chartData: {
        categoryBreakdown: { available: false as const, categories: [], costs: [], tokens: [] },
        hourlyTimeline: { hours: new Array(24).fill(0) as number[], peakHour: 0 },
        dailyBars: { points: [...zeroPoints, ...recentPoints], budgetLine: 15, projectedLine: 5 },
        modelBreakdown: { labels: [], credits: [], costs: [], tokens: [], cheapestEquivalentCosts: [] },
        heatmap: { cells: [], max: 0 },
      },
      allModels: [],
      allSurfaces: [],
      allSources: [],
      allRepos: [],
      byRepo: [],
      budget: { monthly: null, includedCredits: 450, usedCredits: 0, usedCost: 0, percentOfBudget: 0, percentOfIncluded: 0, projectedOverage: null, pace: 'no-budget' as const },
      forecast: { basis: 'linear' as const, projectedCredits: 150, projectedCost: 6, low: 100, high: 200, granularity: 'month' as const, asOf: now },
      today: { credits: 0, cost: 0, tokens: 0 },
      filter: {},
      currency: 'USD',
      pricePerCredit: 0.04,
      status: { kind: 'ok' as const },
      authStatus: 'signed-out' as const,
      isIncremental: false,
      currentBranchCredits: 0,
      range: { start: now - 30 * 86400000, end: now },
    } as unknown as UsageSnapshot;
    const p = buildMetricPayload(snap);
    assert.equal(p.budget_trend, -1);
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

  it('credits_velocity_per_hour is 0 when generatedAt is at midnight (hoursElapsed <= 0.1)', () => {
    // 30 seconds past midnight → hoursElapsed ≈ 0.0083, below 0.1 threshold
    const midnight = new Date(2026, 0, 1, 0, 0, 30).getTime();
    const s = buildSnapshot([makeEvent({ ts: midnight - 60000, credits: 5 })], opts({ now: midnight }));
    const p = buildMetricPayload(s);
    assert.equal(p.credits_velocity_per_hour, 0);
  });

  it('daily_credit_variance is 0 with 1 or fewer daily data points', () => {
    const now = Date.now();
    const snap = {
      generatedAt: now,
      source: 'local' as const,
      topModels: [],
      sankeyLinks: [],
      chartData: {
        categoryBreakdown: { available: false as const, categories: [], costs: [], tokens: [] },
        hourlyTimeline: { hours: new Array(24).fill(0) as number[], peakHour: 0 },
        dailyBars: { points: [{ date: '06-01', credits: 5, cost: 0.2, colorIndex: 0 as const }], budgetLine: null, projectedLine: null },
        modelBreakdown: { labels: [], credits: [], costs: [], tokens: [], cheapestEquivalentCosts: [] },
        heatmap: { cells: [], max: 0 },
      },
      allModels: [],
      allSurfaces: [],
      allSources: [],
      allRepos: [],
      byRepo: [],
      budget: { monthly: null, includedCredits: 300, usedCredits: 0, usedCost: 0, percentOfBudget: 0, percentOfIncluded: 0, projectedOverage: null, pace: 'no-budget' as const },
      forecast: { basis: 'insufficient-data' as const, projectedCredits: 0, projectedCost: 0, low: 0, high: 0, granularity: 'month' as const, asOf: now },
      today: { credits: 0, cost: 0, tokens: 0 },
      filter: {},
      currency: 'USD',
      pricePerCredit: 0.04,
      status: { kind: 'ok' as const },
      authStatus: 'signed-out' as const,
      isIncremental: false,
      currentBranchCredits: 0,
      range: { start: now - 86400000, end: now },
    } as unknown as UsageSnapshot;
    const p = buildMetricPayload(snap);
    assert.equal(p.daily_credit_variance, 0);
  });

  it('estimated_event_ratio is 0 when all events are from github source', () => {
    const now = Date.now();
    const s = buildSnapshot([makeEvent({ ts: now - 1000, source: 'github' })], opts({ now, source: 'github' }));
    const p = buildMetricPayload(s);
    assert.equal(p.estimated_event_ratio, 0);
  });

  it('estimated_event_ratio is 1 when all events are estimated (local source)', () => {
    const now = Date.now();
    const s = buildSnapshot([makeEvent({ ts: now - 1000, source: 'local' })], opts({ now }));
    const p = buildMetricPayload(s);
    assert.equal(p.estimated_event_ratio, 1);
  });

  it('estimated_event_ratio is 0.5 when sources are mixed (github + local)', () => {
    const now = Date.now();
    const s = buildSnapshot([
      makeEvent({ ts: now - 1000, source: 'github' }),
      makeEvent({ ts: now - 2000, source: 'local' }),
    ], opts({ now }));
    const p = buildMetricPayload(s);
    assert.equal(p.estimated_event_ratio, 0.5);
  });

  it('surface_concentration is 0 when there are no sankey links (empty surface_dist)', () => {
    const s = buildSnapshot([], opts());
    const p = buildMetricPayload(s);
    assert.equal(p.surface_concentration, 0);
  });

  it('surface_concentration is 0 for a single surface (gini of one value = 0)', () => {
    const now = Date.now();
    const events = [makeEvent({ ts: now - 1000, credits: 5, surface: 'chat' })];
    const s = buildSnapshot(events, opts({ now }));
    const p = buildMetricPayload(s);
    assert.equal(p.surface_concentration, 0);
  });

  it('token_per_credit is 0 when totalCredits is 0 (no events)', () => {
    const s = buildSnapshot([], opts());
    const p = buildMetricPayload(s);
    assert.equal(p.token_per_credit, 0);
  });

  it('daily_credit_variance is 0 when all last-7-day values are identical', () => {
    const now = new Date(2026, 5, 10, 12).getTime();
    const events = Array.from({ length: 7 }, (_, i) =>
      makeEvent({ ts: new Date(2026, 5, 4 + i, 12).getTime(), credits: 5 }),
    );
    const s = buildSnapshot(events, opts({ now }));
    const p = buildMetricPayload(s);
    assert.equal(p.daily_credit_variance, 0);
  });

  it('input_cost_ratio reflects actual input/output category breakdown', () => {
    const now = Date.now();
    const events = [
      makeEvent({ ts: now - 1000, credits: 1, cost: 0.1, costByCategory: { input: 0.06, output: 0.04 } }),
    ];
    const s = buildSnapshot(events, opts({ now }));
    const p = buildMetricPayload(s);
    assert.ok(Math.abs(p.input_cost_ratio - 0.6) < 0.001);
  });

  it('cost_dist includes cache_creation and cache_read when present', () => {
    const now = Date.now();
    const events = [
      makeEvent({ ts: now - 1000, credits: 1, cost: 0.1,
        costByCategory: { input: 0.03, output: 0.02, cache_creation: 0.04, cache_read: 0.01 } }),
    ];
    const s = buildSnapshot(events, opts({ now }));
    const p = buildMetricPayload(s);
    assert.ok('cache_creation' in p.cost_dist, 'cache_creation missing from cost_dist');
    assert.ok('cache_read' in p.cost_dist, 'cache_read missing from cost_dist');
    const total = Object.values(p.cost_dist).reduce((a, x) => a + x, 0);
    assert.ok(total <= 1.0001, `cost_dist total ${total} exceeds 1`);
  });
});
