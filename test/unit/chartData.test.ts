import { strict as assert } from 'assert';
import { aggregateBy } from '../../src/model/aggregate';
import {
  buildDailyBarsData,
  buildHeatmapData,
  buildModelBreakdownData,
} from '../../src/model/chartData';
import { BudgetState, Forecast, TopEntry } from '../../src/model/types';
import { DAY_MS, startOf } from '../../src/util/time';
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
    const data = buildModelBreakdownData(tops);
    assert.deepStrictEqual(data.labels, ['gpt-4o', 'claude-sonnet-4', 'gemini-pro']);
    assert.deepStrictEqual(data.credits, [10, 5, 2]);
    assert.deepStrictEqual(data.costs, [0.4, 0.2, 0.08]);
  });

  it('caps at 8 models', () => {
    const tops: TopEntry[] = Array.from({ length: 12 }, (_, i) => ({
      key: `model-${i}`,
      credits: i,
      cost: i * 0.04,
      tokens: i * 100,
    }));
    const data = buildModelBreakdownData(tops);
    assert.strictEqual(data.labels.length, 8);
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

    const targetIso = new Date(targetDay).toISOString().slice(0, 10);
    const cell = data.cells.find((c) => c.date === targetIso);
    assert.ok(cell, 'expected cell for target day');
    assert.strictEqual(cell!.value, 7);
    assert.strictEqual(data.max, 7);
  });
});
