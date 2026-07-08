import { strict as assert } from 'assert';
import { buildMetricPayload } from '../../src/extension-backend/export/payload';
import { buildSnapshot, SnapshotOptions } from './snapshotFixture';
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
      'schema_version', 'instance_id', 'ts', 'tz_offset_minutes',
      'mtd_credits', 'mtd_cost_usd', 'today_credits', 'today_cost_usd',
      'mtd_budget_pct', 'forecast_basis', 'forecast_low', 'forecast_high',
      'budget_trend', 'daily_credit_stddev',
      'total_credits', 'total_tokens', 'total_event_count', 'estimated_event_count',
      'model_credits', 'surface_credits', 'language_credits', 'cost_by_category',
      'active_models', 'top_model', 'model_count', 'repo_count',
      'source_connector',
    ];
    for (const key of EXPECTED) {
      assert.ok(key in p, `missing key: ${key}`);
    }
    assert.equal(Object.keys(p).length, EXPECTED.length, 'no undeclared keys');
  });

  it('schema_version is always 3', () => {
    const s = buildSnapshot([makeEvent({ ts: Date.now() - 1000 })], opts());
    assert.equal(buildMetricPayload(s).schema_version, 3);
  });

  it('tz_offset_minutes matches the client UTC offset at snapshot time', () => {
    const s = buildSnapshot([makeEvent({ ts: Date.now() - 1000 })], opts());
    const p = buildMetricPayload(s);
    assert.equal(p.tz_offset_minutes, -new Date(s.generatedAt).getTimezoneOffset());
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

  it('cost_by_category carries absolute USD amounts, not fractions', () => {
    const now = Date.now();
    const events = [
      makeEvent({ ts: now - 1000, credits: 1, cost: 0.1, costByCategory: { input: 0.06, output: 0.04 } }),
    ];
    const s = buildSnapshot(events, opts({ now }));
    const p = buildMetricPayload(s);
    assert.ok(Math.abs(p.cost_by_category['input']! - 0.06) < 1e-9);
    assert.ok(Math.abs(p.cost_by_category['output']! - 0.04) < 1e-9);
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

  it('model_credits carries absolute credits per model (additive server-side)', () => {
    const now = Date.now();
    const events = [
      makeEvent({ ts: now - 1000, modelId: 'gpt-4o', credits: 3 }),
      makeEvent({ ts: now - 2000, modelId: 'claude-3.5-sonnet', credits: 1 }),
    ];
    const s = buildSnapshot(events, opts({ now }));
    const p = buildMetricPayload(s);
    assert.equal(p.model_credits['gpt-4o'], 3);
    assert.equal(p.model_credits['claude-3.5-sonnet'], 1);
    assert.equal(p.total_credits, 4);
  });

  it('cost_by_category is empty when category data is unavailable', () => {
    const s = buildSnapshot([makeEvent({ ts: Date.now() - 1000, modelId: 'gpt-4o' })], opts());
    const p = buildMetricPayload(s);
    assert.deepEqual(p.cost_by_category, {});
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
      byLanguage: [],
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
      byLanguage: [],
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

  it('daily_credit_stddev is 0 with 1 or fewer daily data points', () => {
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
      byLanguage: [],
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
    assert.equal(p.daily_credit_stddev, 0);
  });

  it('event counts pass through from the snapshot (server derives the ratio)', () => {
    const now = Date.now();
    const s = buildSnapshot([
      makeEvent({ ts: now - 1000, source: 'github' }),
      makeEvent({ ts: now - 2000, source: 'local' }),
    ], opts({ now }));
    const p = buildMetricPayload({ ...s, totalEventCount: 10, estimatedEventCount: 3 });
    assert.equal(p.total_event_count, 10);
    assert.equal(p.estimated_event_count, 3);
  });

  it('event counts default to 0 for an empty snapshot', () => {
    const s = buildSnapshot([], opts());
    const p = buildMetricPayload(s);
    assert.equal(p.total_event_count, 0);
    assert.equal(p.estimated_event_count, 0);
  });

  it('language_credits carries absolute per-language credits from byLanguage', () => {
    const s = buildSnapshot([], opts());
    s.byLanguage = [
      { key: 'typescript', credits: 12, cost: 0.48, tokens: 1200 },
      { key: 'unknown', credits: 3, cost: 0.12, tokens: 300 },
    ];
    const p = buildMetricPayload(s);
    assert.deepEqual(p.language_credits, { typescript: 12, unknown: 3 });
  });

  it('surface_credits carries absolute per-surface credits from sankey links', () => {
    const now = Date.now();
    const events = [
      makeEvent({ ts: now - 1000, credits: 5, surface: 'chat' }),
      makeEvent({ ts: now - 2000, credits: 3, surface: 'agent' }),
    ];
    const s = buildSnapshot(events, opts({ now }));
    const p = buildMetricPayload(s);
    assert.equal(p.surface_credits['chat'], 5);
    assert.equal(p.surface_credits['agent'], 3);
  });

  it('surface_credits is empty when there are no sankey links', () => {
    const s = buildSnapshot([], opts());
    assert.deepEqual(buildMetricPayload(s).surface_credits, {});
  });

  it('total_credits and total_tokens are 0 for an empty snapshot', () => {
    const s = buildSnapshot([], opts());
    const p = buildMetricPayload(s);
    assert.equal(p.total_credits, 0);
    assert.equal(p.total_tokens, 0);
  });

  it('daily_credit_stddev is 0 when all last-7-day values are identical', () => {
    const now = new Date(2026, 5, 10, 12).getTime();
    const events = Array.from({ length: 7 }, (_, i) =>
      makeEvent({ ts: new Date(2026, 5, 4 + i, 12).getTime(), credits: 5 }),
    );
    const s = buildSnapshot(events, opts({ now }));
    const p = buildMetricPayload(s);
    assert.equal(p.daily_credit_stddev, 0);
  });

  it('cost_by_category includes cache_creation and cache_read when present', () => {
    const now = Date.now();
    const events = [
      makeEvent({ ts: now - 1000, credits: 1, cost: 0.1,
        costByCategory: { input: 0.03, output: 0.02, cache_creation: 0.04, cache_read: 0.01 } }),
    ];
    const s = buildSnapshot(events, opts({ now }));
    const p = buildMetricPayload(s);
    assert.ok(Math.abs(p.cost_by_category['cache_creation']! - 0.04) < 1e-9);
    assert.ok(Math.abs(p.cost_by_category['cache_read']! - 0.01) < 1e-9);
  });
});
