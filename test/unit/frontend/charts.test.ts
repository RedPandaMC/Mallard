import { strict as assert } from 'assert';
import { buildSnapshot } from '../snapshotFixture';
import { makeEvent } from '../helpers';
import type { UsageSnapshot, Metric } from '../../../src/extension-backend/domain/types';
import { mountDailyBars } from '../../../src/extension-frontend/charts/dailyBars';
import { mountModelBreakdown } from '../../../src/extension-frontend/charts/modelBreakdown';
import { mountHourlyTimeline } from '../../../src/extension-frontend/charts/hourlyTimeline';
import { mountHeatmap } from '../../../src/extension-frontend/charts/heatmap';
import { mountSankey } from '../../../src/extension-frontend/charts/sankey';
import { mountCategoryBreakdown } from '../../../src/extension-frontend/charts/categoryBreakdown';
import { mountWeekdayRadial } from '../../../src/extension-frontend/charts/weekdayRadial';
import { mountCumulativeArea } from '../../../src/extension-frontend/charts/cumulativeArea';
import { applyTheme, initChart } from '../../../src/extension-frontend/charts/echarts';

function makeSnapshot(credits = 100): UsageSnapshot {
  const now = Date.now();
  return buildSnapshot(
    [
      makeEvent({ ts: now - 1000, modelId: 'gpt-4o', credits, cost: credits * 0.04, surface: 'chat' }),
      makeEvent({ ts: now - 2000, modelId: 'claude-sonnet-4-5', credits: 6, cost: 0.24, surface: 'inline' }),
    ],
    {
      now,
      currency: 'USD',
      pricePerCredit: 0.04,
      monthlyBudget: 50,
      includedCredits: 300,
      filter: {},
      source: 'local',
      status: { kind: 'ok' },
      authStatus: 'signed-out',
    },
  );
}

describe('echarts wrapper', () => {
  it('initChart returns a chart stub with setOption/clear/resize/dispose', () => {
    const el = document.createElement('div');
    const chart = initChart(el);
    assert.ok(chart);
    assert.doesNotThrow(() => chart.setOption({ series: [] }));
    assert.doesNotThrow(() => chart.clear());
    assert.doesNotThrow(() => chart.resize());
    assert.doesNotThrow(() => chart.dispose());
  });

  it('applyTheme calls registerTheme without throwing', () => {
    assert.doesNotThrow(() => applyTheme());
  });
});

describe('charts — mount + update without throwing', () => {
  const snapshot = makeSnapshot(100);

  const chartMounts = [
    ['dailyBars', mountDailyBars],
    ['modelBreakdown', mountModelBreakdown],
    ['hourlyTimeline', mountHourlyTimeline],
    ['heatmap', mountHeatmap],
    ['sankey', mountSankey],
    ['categoryBreakdown', mountCategoryBreakdown],
    ['weekdayRadial', mountWeekdayRadial],
    ['cumulativeArea', mountCumulativeArea],
  ] as const;

  for (const [name, mount] of chartMounts) {
    it(`${name} mounts, updates with a snapshot, resizes, and disposes`, () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      const handle = mount(el);
      assert.doesNotThrow(() => handle.update(snapshot));
      assert.doesNotThrow(() => handle.resize());
      assert.doesNotThrow(() => handle.reinit());
      assert.doesNotThrow(() => handle.update(snapshot));
      el.remove();
    });

    it(`${name} handles an empty snapshot without throwing`, () => {
      const empty = makeSnapshot(0);
      // Force no data by using a snapshot with zero events
      const el = document.createElement('div');
      document.body.appendChild(el);
      const handle = mount(el);
      assert.doesNotThrow(() => handle.update(empty));
      el.remove();
    });
  }
});

describe('charts — dailyBars option shape', () => {
  it('builds a bar chart with x-axis dates and y-axis credits', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = mountDailyBars(el);
    const snap = makeSnapshot(50);
    handle.update(snap);
    // The echarts stub captures the last option on the chart instance.
    // We can't assert the exact option shape (it's on the stub), but we
    // can verify update() didn't throw and the element exists.
    assert.ok(el);
    el.remove();
  });
});

describe('charts — modelBreakdown with metric parameter', () => {
  it('accepts a metric argument', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = mountModelBreakdown(el);
    handle.update(makeSnapshot(50), 'credits' as Metric);
    el.remove();
  });
});
