import { strict as assert } from 'assert';
import { aggregateBy } from '../../src/extension-backend/domain/aggregate';
import {
  buildCategoryBreakdownData,
  buildChartData,
  buildDailyBarsData,
  buildHeatmapData,
  buildHourlyTimelineData,
  buildModelBreakdownData,
} from '../../src/extension-backend/domain/chartData';
import { PricingManifest } from '../../src/extension-backend/domain/pricing';
import { BudgetState, Forecast, TopEntry } from '../../src/extension-backend/domain/types';
import { DAY_MS, startOf } from '../../src/extension-backend/util/time';
import { makeEvent } from './helpers';

const EMPTY_BUDGET: BudgetState = {
  monthly: null,
  includedCredits: 0,
  usedCredits: 0,
  usedCost: 0,
  percentOfBudget: 0,
  percentOfIncluded: 0,
  projectedOverage: null,
  pace: 'no-budget',
};

const INSUF_FORECAST: Forecast = {
  granularity: 'month',
  projectedCredits: 0,
  projectedCost: 0,
  low: 0,
  high: 0,
  basis: 'insufficient-data',
  asOf: 0,
};

describe('buildDailyBarsData', () => {
  it('returns 30 points for any input', () => {
    const data = buildDailyBarsData([], EMPTY_BUDGET, INSUF_FORECAST, Date.now());
    assert.strictEqual(data.points.length, 30);
    assert.strictEqual(data.budgetLine, null);
    assert.strictEqual(data.projectedLine, null);
  });

  it('assigns correct color indices based on daily budget', () => {
    const now = startOf(Date.now(), 'day');
    const events = [
      { ts: now - 2 * DAY_MS, credits: 1, cost: 0.04 },
      { ts: now - 1 * DAY_MS, credits: 8, cost: 0.32 },
    ];
    // Use aggregateBy to get UsageAggregate[] in the expected shape

    const evts = events.map((e) => makeEvent(e));
    const dayAggs = aggregateBy(evts, 'day');

    const budget: BudgetState = { ...EMPTY_BUDGET, includedCredits: 100 };
    const data = buildDailyBarsData(dayAggs, budget, INSUF_FORECAST, now);

    assert.strictEqual(data.budgetLine, 100 / 30);
    // day with 1 credit out of (100/30 ≈ 3.33) → ratio ≈ 0.3 → blue (0)
    const lowDay = data.points.find((p) => p.credits === 1);
    assert.ok(lowDay, 'expected a low-credit day');
    assert.strictEqual(lowDay!.colorIndex, 0);

    // day with 8 credits out of (100/30 ≈ 3.33) → ratio ≈ 2.4 → red (2)
    const highDay = data.points.find((p) => p.credits === 8);
    assert.ok(highDay, 'expected a high-credit day');
    assert.strictEqual(highDay!.colorIndex, 2);
  });

  it('assigns colorIndex 1 when credits are between 70% and 100% of daily budget', () => {
    const now = startOf(Date.now(), 'day');
    const evts = [makeEvent({ ts: now - 1 * DAY_MS, credits: 2.5, cost: 0.1 })];
    const dayAggs = aggregateBy(evts, 'day');
    // dailyBudget = 30/30 = 1.0, ratio = 2.5/1.0 = 2.5 → well above 1.0 → colorIndex=2
    // Let's use includedCredits=90 → dailyBudget=3, credits=2.5 → ratio=0.833 → colorIndex=1
    const budget: BudgetState = { ...EMPTY_BUDGET, includedCredits: 90 };
    const data = buildDailyBarsData(dayAggs, budget, INSUF_FORECAST, now);
    const day = data.points.find((p) => p.credits === 2.5);
    assert.ok(day, 'expected a day with 2.5 credits');
    assert.strictEqual(day!.colorIndex, 1);
  });

  it('sets projectedLine when forecast is available', () => {
    const forecast: Forecast = { ...INSUF_FORECAST, basis: 'linear', projectedCredits: 300 };
    const data = buildDailyBarsData([], EMPTY_BUDGET, forecast, Date.now());
    assert.strictEqual(data.projectedLine, 10); // 300 / 30
  });

  it('formats dates as MM-DD', () => {
    const data = buildDailyBarsData([], EMPTY_BUDGET, INSUF_FORECAST, Date.now());
    for (const p of data.points) {
      assert.match(p.date, /^\d{2}-\d{2}$/, `expected MM-DD, got ${p.date}`);
    }
  });
});

describe('buildModelBreakdownData', () => {
  it('strips provider prefixes and truncates labels', () => {
    const tops: TopEntry[] = [
      { key: 'openai/gpt-4o', credits: 10, cost: 0.4, tokens: 1000 },
      { key: 'anthropic/claude-sonnet-4', credits: 5, cost: 0.2, tokens: 500 },
      { key: 'models/gemini-pro', credits: 2, cost: 0.08, tokens: 200 },
    ];
    const data = buildModelBreakdownData(tops, 0.04);
    assert.deepStrictEqual(data.labels, ['gpt-4o', 'claude-sonnet-4', 'gemini-pro']);
    assert.deepStrictEqual(data.credits, [10, 5, 2]);
    assert.deepStrictEqual(data.costs, [0.4, 0.2, 0.08]);
  });

  it('uses minMultiplier from manifest when models have non-zero multipliers', () => {
    const tops: TopEntry[] = [
      { key: 'gpt-4o', credits: 10, cost: 0.4, tokens: 1000 },
    ];
    const manifest: PricingManifest = {
      version: 1,
      pricePerCredit: 0.04,
      updatedAt: '2025-01-01',
      models: { 'gpt-4o': 0.5, 'claude-opus-4': 10 },
    };
    const data = buildModelBreakdownData(tops, 0.04, manifest);
    // minMultiplier = min(0.5, 10) = 0.5; cheapest = 1000 * 0.5 * 0.04 = 20
    assert.ok(data.cheapestEquivalentCosts.length > 0);
    assert.ok(Math.abs(data.cheapestEquivalentCosts[0]! - 20) < 0.001);
  });

  it('strips google/ prefix via shortModelName', () => {
    const tops: TopEntry[] = [
      { key: 'google/gemini-pro', credits: 5, cost: 0.2, tokens: 500 },
    ];
    const data = buildModelBreakdownData(tops, 0.04);
    assert.strictEqual(data.labels[0], 'gemini-pro');
  });

  it('caps at 8 models', () => {
    const tops: TopEntry[] = Array.from({ length: 12 }, (_, i) => ({
      key: `model-${i}`,
      credits: i,
      cost: i * 0.04,
      tokens: i * 100,
    }));
    const data = buildModelBreakdownData(tops, 0.04);
    assert.strictEqual(data.labels.length, 8);
  });
});

describe('buildHourlyTimelineData', () => {
  it('accumulates credits per hour', () => {
    const now = startOf(Date.now(), 'day') + 10 * 3600_000; // 10am today
    const events = [
      makeEvent({ ts: now, credits: 3, modelId: 'gpt-4o' }),
      makeEvent({ ts: now, credits: 5, modelId: 'claude-sonnet-4' }),
    ];
    const data = buildHourlyTimelineData(events);
    assert.equal(data.hours[10], 8);
    assert.equal(data.peakHour, 10);
  });

  it('skips events that do not match the filter', () => {
    const now = startOf(Date.now(), 'day') + 10 * 3600_000;
    const events = [
      makeEvent({ ts: now, credits: 5, modelId: 'gpt-4o' }),
      makeEvent({ ts: now, credits: 3, modelId: 'claude-sonnet-4' }),
    ];
    const data = buildHourlyTimelineData(events, { models: ['gpt-4o'] });
    assert.equal(data.hours[10], 5);
  });
});

describe('buildCategoryBreakdownData', () => {
  it('reports unavailable when no event carries a breakdown', () => {
    const data = buildCategoryBreakdownData([makeEvent({ ts: 1000, cost: 0.04 })]);
    assert.strictEqual(data.available, false);
    assert.deepStrictEqual(data.categories, []);
  });

  it('sums per-category cost in canonical order, dropping zero buckets', () => {
    const events = [
      makeEvent({ ts: 1000, cost: 0.1, costByCategory: { input: 0.06, output: 0.04 } }),
      makeEvent({ ts: 2000, cost: 0.05, costByCategory: { output: 0.05, tool: 0 } }),
    ];
    const data = buildCategoryBreakdownData(events);
    assert.strictEqual(data.available, true);
    assert.deepStrictEqual(data.categories, ['input', 'output']);
    assert.ok(Math.abs(data.costs[0]! - 0.06) < 1e-9);
    assert.ok(Math.abs(data.costs[1]! - 0.09) < 1e-9);
  });
});

describe('buildHeatmapData', () => {
  it('returns 12 weeks of cells', () => {
    const now = startOf(Date.now(), 'day');
    const data = buildHeatmapData([], now);
    assert.strictEqual(data.cells.length, 12 * 7 + 1); // inclusive range
    assert.strictEqual(data.max, 0);
  });

  it('maps aggregate credits to the correct date', () => {
    const now = startOf(Date.now(), 'day');
    const targetDay = now - 3 * DAY_MS;

    const dayAggs = aggregateBy([makeEvent({ ts: targetDay, credits: 7 })], 'day');
    const data = buildHeatmapData(dayAggs, now);

    const dt = new Date(targetDay);
    const targetLocal = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const cell = data.cells.find((c) => c.date === targetLocal);
    assert.ok(cell, 'expected cell for target day');
    assert.strictEqual(cell!.value, 7);
    assert.strictEqual(data.max, 7);
  });

  it('labels cells using local calendar dates, not UTC (regression)', () => {
    // In timezones ahead of UTC, local midnight is still the previous UTC
    // day — a naive toISOString().slice(0,10) would mislabel every cell one
    // day earlier. Force a UTC+2 zone to catch that regression.
    const originalTz = process.env.TZ;
    process.env.TZ = 'Europe/Amsterdam';
    try {
      const now = startOf(Date.now(), 'day');
      const targetDay = now - 3 * DAY_MS;
      const dayAggs = aggregateBy([makeEvent({ ts: targetDay, credits: 9 })], 'day');
      const data = buildHeatmapData(dayAggs, now);

      const dt = new Date(targetDay);
      const targetLocal = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const targetUtc = new Date(targetDay).toISOString().slice(0, 10);

      const cell = data.cells.find((c) => c.date === targetLocal);
      assert.ok(cell, 'expected cell keyed by local calendar date');
      assert.strictEqual(cell!.value, 9);
      assert.notStrictEqual(
        targetLocal,
        targetUtc,
        'test is only meaningful when local and UTC dates actually differ',
      );
      assert.ok(
        !data.cells.some((c) => c.date === targetUtc && c.value === 9),
        'value must not be mislabeled under the UTC date',
      );
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });
});

describe('buildCategoryBreakdownData — filter', () => {
  it('excludes events not matching the filter', () => {
    const events = [
      makeEvent({ ts: 1_000_000, modelId: 'gpt-4o', costByCategory: { input: 0.05 } }),
      makeEvent({ ts: 2_000_000, modelId: 'claude-sonnet-4', costByCategory: { input: 0.03 } }),
    ];
    const result = buildCategoryBreakdownData(events, { models: ['gpt-4o'] });
    assert.equal(result.available, true);
    assert.ok(result.categories.length > 0);
  });

  it('returns unavailable when all events are filtered out', () => {
    const events = [makeEvent({ ts: 1_000_000, modelId: 'gpt-4o', costByCategory: { input: 0.05 } })];
    const result = buildCategoryBreakdownData(events, { models: ['claude-sonnet-4'] });
    assert.equal(result.available, false);
  });
});

describe('buildChartData', () => {
  it('applies display prefs to window sizes and topN', () => {
    const now = startOf(Date.now(), 'day');
    const events = [makeEvent({ ts: now - DAY_MS, credits: 5, cost: 0.20 })];
    const dayAggs = aggregateBy(events, 'day');
    const category = buildCategoryBreakdownData(events);
    const hourly = buildHourlyTimelineData(events);

    const result = buildChartData(
      dayAggs, [], EMPTY_BUDGET, INSUF_FORECAST, now,
      category, hourly, 0.04, undefined, undefined,
      { dailyBarsWindow: 14, topN: 3, heatmapWeeks: 6 },
    );

    assert.strictEqual(result.dailyBars.points.length, 14);
    // heatmap loop: for (i = weeks*7; i >= 0; i--) → inclusive → weeks*7+1 cells
    assert.strictEqual(result.heatmap.cells.length, 6 * 7 + 1);
    assert.ok(result.modelBreakdown.labels.length === 0); // no models in input
  });
});
