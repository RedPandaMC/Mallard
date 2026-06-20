import { strict as assert } from 'assert';
import { changed } from '../../webview/chartDiff';

describe('changed', () => {
  it('returns true when prev is undefined', () => {
    assert.ok(changed(undefined, { a: 1 }));
  });

  it('returns false for deeply equal values', () => {
    assert.ok(!changed({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] }));
  });

  it('returns true when a nested value differs', () => {
    assert.ok(changed({ a: 1, b: [1, 2] }, { a: 1, b: [1, 3] }));
  });

  it('returns true when key is added', () => {
    assert.ok(changed({ a: 1 }, { a: 1, b: 2 }));
  });

  it('handles primitive types', () => {
    assert.ok(!changed(42, 42));
    assert.ok(changed(42, 43));
    assert.ok(!changed('x', 'x'));
    assert.ok(changed('x', 'y'));
  });
});

import {
  dailyBarsChanged,
  heatmapChanged,
  modelBreakdownChanged,
  categoryBreakdownChanged,
  hourlyChanged,
} from '../../webview/chartDiff';
import type { DailyBarsData, HeatmapData, ModelBreakdownData, CategoryBreakdownData, HourlyTimelineData } from '../../src/domain/types';

describe('dailyBarsChanged', () => {
  const base: DailyBarsData = { points: [{ date: '06-20', credits: 5, cost: 0.2, colorIndex: 0 }], budgetLine: null, projectedLine: null };
  it('returns true when prev is undefined', () => assert.ok(dailyBarsChanged(undefined, base)));
  it('returns false for identical data', () => assert.ok(!dailyBarsChanged(base, base)));
  it('returns true when a point credits changes', () => {
    const next: DailyBarsData = { ...base, points: [{ ...base.points[0]!, credits: 10 }] };
    assert.ok(dailyBarsChanged(base, next));
  });
  it('returns true when budgetLine changes', () => {
    assert.ok(dailyBarsChanged(base, { ...base, budgetLine: 10 }));
  });
});

describe('heatmapChanged', () => {
  const base: HeatmapData = { cells: [{ date: '2026-06-20', value: 5 }], max: 5 };
  it('returns true when prev is undefined', () => assert.ok(heatmapChanged(undefined, base)));
  it('returns false for identical data', () => assert.ok(!heatmapChanged(base, base)));
  it('returns true when a cell value changes', () => {
    assert.ok(heatmapChanged(base, { cells: [{ date: '2026-06-20', value: 10 }], max: 10 }));
  });
});

describe('modelBreakdownChanged', () => {
  const base: ModelBreakdownData = { labels: ['gpt-4o'], credits: [5], costs: [0.2], tokens: [1000], cheapestEquivalentCosts: [0.1] };
  it('returns true when prev is undefined', () => assert.ok(modelBreakdownChanged(undefined, base)));
  it('returns false for identical data', () => assert.ok(!modelBreakdownChanged(base, base)));
  it('returns true when credits change', () => {
    assert.ok(modelBreakdownChanged(base, { ...base, credits: [10] }));
  });
});

describe('categoryBreakdownChanged', () => {
  const base: CategoryBreakdownData = { categories: ['input', 'output'], costs: [0.1, 0.2], available: true };
  it('returns true when prev is undefined', () => assert.ok(categoryBreakdownChanged(undefined, base)));
  it('returns false for identical data', () => assert.ok(!categoryBreakdownChanged(base, base)));
  it('returns true when available flag changes', () => {
    assert.ok(categoryBreakdownChanged(base, { ...base, available: false }));
  });
});

describe('hourlyChanged', () => {
  const base: HourlyTimelineData = { hours: [0, 1, 2], peakHour: 1 };
  it('returns true when prev is undefined', () => assert.ok(hourlyChanged(undefined, base)));
  it('returns false for identical data', () => assert.ok(!hourlyChanged(base, base)));
  it('returns true when peakHour changes', () => {
    assert.ok(hourlyChanged(base, { ...base, peakHour: 2 }));
  });
});
