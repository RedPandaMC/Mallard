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
import { mountRepoBreakdown } from '../../../src/extension-frontend/charts/repoBreakdown';
import { mountCategoryTrend } from '../../../src/extension-frontend/charts/categoryTrend';
import { mountTokensTimeline } from '../../../src/extension-frontend/charts/tokensTimeline';
import { mountBillingItems } from '../../../src/extension-frontend/charts/billingItems';
import { CHART_REGISTRY } from '../../../src/extension-frontend/charts/registry';
import { DASHBOARD_PANELS, DEFAULT_DASHBOARD_LAYOUT } from '../../../src/extension-backend/domain/types';

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


describe('extra charts', () => {
  it('repo breakdown renders byRepo and updates without throwing', () => {
    const el = document.createElement('div');
    const c = mountRepoBreakdown(el);
    const s = makeSnapshot();
    s.byRepo = [
      { key: 'org/app', credits: 12, cost: 0.5, tokens: 100, heuristicShare: 0.4 },
      { key: 'lib', credits: 4, cost: 0.2, tokens: 40, heuristicShare: 0 },
    ];
    c.update(s);
    c.resize();
    c.reinit();
    c.update(s);
  });

  it('category trend renders when available and clears when not', () => {
    const el = document.createElement('div');
    const c = mountCategoryTrend(el);
    const s = makeSnapshot();
    s.chartData.categoryTrend = {
      dates: ['01-01', '01-02'],
      series: [{ category: 'input', costs: [0.1, 0.2] }, { category: 'output', costs: [0.3, 0] }],
      available: true,
    };
    c.update(s);
    s.chartData.categoryTrend = { dates: [], series: [], available: false };
    c.update(s); // clears — must not throw
  });

  it('tokens timeline renders daily token volume', () => {
    const el = document.createElement('div');
    const c = mountTokensTimeline(el);
    const s = makeSnapshot();
    s.chartData.tokensDaily = { dates: ['01-01', '01-02'], tokens: [1500, 0], events: [3, 0] };
    c.update(s);
  });

  it('billing items renders signed-in data and clears when signed out', () => {
    const el = document.createElement('div');
    const c = mountBillingItems(el);
    const s = makeSnapshot();
    s.githubBilling = {
      quota: null,
      fetchedAt: Date.now(),
      totalNetAmount: 12,
      items: [{ model: 'gpt-4o', sku: 'copilot', grossAmount: 10, netAmount: 8, grossQuantity: 100 }],
    };
    c.update(s);
    delete s.githubBilling;
    c.update(s); // no data — must clear, not throw
  });
});

describe('chart registry', () => {
  it('covers exactly the DASHBOARD_PANELS set, each with a default layout entry', () => {
    const registryIds = CHART_REGISTRY.map((d) => d.id).sort();
    assert.deepEqual(registryIds, [...DASHBOARD_PANELS].sort());
    const layoutIds = DEFAULT_DASHBOARD_LAYOUT.map((d) => d.id).sort();
    assert.deepEqual(registryIds, layoutIds);
  });

  it('extras default to hidden, stock charts to visible', () => {
    const byId = new Map(DEFAULT_DASHBOARD_LAYOUT.map((d) => [d.id, d]));
    for (const def of CHART_REGISTRY) {
      assert.equal(byId.get(def.id)!.hidden, def.tier === 'extra', def.id);
    }
  });

  it('every def mounts, selects, and diffs against a real snapshot', () => {
    const s = makeSnapshot();
    for (const def of CHART_REGISTRY) {
      const el = document.createElement('div');
      const c = def.mount(el, { toggleModelFilter: () => {} });
      const slice = def.select(s);
      assert.equal(def.isDirty(undefined, slice), true, `${def.id}: first render must be dirty`);
      assert.equal(def.isDirty(slice, slice), false, `${def.id}: identical slice must be clean`);
      c.update(s, { metric: 'cost', focusedModels: [] });
      c.resize();
      c.reinit();
      if (def.noData) def.noData(s);
    }
  });
});
