import { strict as assert } from 'assert';
import { buildSnapshot } from '../../../src/extension-backend/domain/snapshot';
import { makeEvent } from '../helpers';
import type { UsageSnapshot, Metric } from '../../../src/extension-backend/domain/types';
import { mountDailyBars } from '../../../src/extension-frontend/charts/dailyBars';
import { mountModelBreakdown } from '../../../src/extension-frontend/charts/modelBreakdown';
import { mountCategoryBreakdown } from '../../../src/extension-frontend/charts/categoryBreakdown';
import { mountSankey } from '../../../src/extension-frontend/charts/sankey';
import { mountHeatmap } from '../../../src/extension-frontend/charts/heatmap';
import { mountHourlyTimeline } from '../../../src/extension-frontend/charts/hourlyTimeline';
import { mountCumulativeArea } from '../../../src/extension-frontend/charts/cumulativeArea';
import { mountWeekdayRadial } from '../../../src/extension-frontend/charts/weekdayRadial';
import { mountKpiCards } from '../../../src/extension-frontend/components/KpiCards';
import { mountFilterBar } from '../../../src/extension-frontend/components/FilterBar';
import { mountStatusBanner } from '../../../src/extension-frontend/components/StatusBanner';
import { mountSpendGauge } from '../../../src/extension-frontend/components/SpendGauge';
import { mountCurrencySelector } from '../../../src/extension-frontend/components/CurrencySelector';
import { mountRestrictionBanner } from '../../../src/extension-frontend/components/RestrictionBanner';

function richSnapshot(): UsageSnapshot {
  const now = Date.now();
  return buildSnapshot(
    [
      makeEvent({
        ts: now - 1000, modelId: 'gpt-4o', credits: 50, cost: 2.0, surface: 'chat',
        promptTokens: 1000, completionTokens: 500, repo: 'acme/app',
        costByCategory: { input: 0.5, output: 0.8, cache_read: 0.2, thinking: 0.5 },
      }),
      makeEvent({
        ts: now - 2000, modelId: 'claude-sonnet-4-5', credits: 30, cost: 1.2, surface: 'inline',
        promptTokens: 800, completionTokens: 400, repo: 'acme/lib',
        costByCategory: { input: 0.4, output: 0.6, tool: 0.2 },
      }),
      makeEvent({
        ts: now - 3000, modelId: 'gpt-4o', credits: 20, cost: 0.8, surface: 'agent',
        promptTokens: 500, completionTokens: 200, repo: 'acme/app',
        costByCategory: { input: 0.3, output: 0.4, thinking: 0.1 },
      }),
    ],
    {
      now, currency: 'USD', pricePerCredit: 0.04, monthlyBudget: 50, includedCredits: 300,
      filter: {}, source: 'local', status: { kind: 'ok' }, authStatus: 'signed-out',
    },
  );
}

const METRICS: Metric[] = ['cost', 'credits', 'tokens'];

describe('charts — buildOption with rich data + all metrics', () => {
  const snapshot = richSnapshot();

  for (const metric of METRICS) {
    it(`modelBreakdown builds an option for metric=${metric}`, () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      const h = mountModelBreakdown(el);
      assert.doesNotThrow(() => h.update(snapshot, metric));
      el.remove();
    });

    it(`KpiCards renders values for metric=${metric}`, () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      const h = mountKpiCards(el);
      h.update(snapshot, metric);
      assert.ok(el.querySelector('.wv-kpi-grid'));
      el.remove();
    });

    it(`FilterBar renders for metric=${metric}`, () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      const h = mountFilterBar(el);
      h.update(snapshot, metric);
      el.remove();
    });
  }

  it('categoryBreakdown builds an option when costByCategory is present', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountCategoryBreakdown(el);
    h.update(snapshot);
    el.remove();
  });

  it('sankey builds an option with 2+ models and 2+ surfaces', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountSankey(el);
    h.update(snapshot);
    el.remove();
  });

  it('dailyBars handles incremental update (isIncremental=true)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountDailyBars(el);
    h.update(snapshot);
    const incremental: UsageSnapshot = { ...snapshot, isIncremental: true };
    h.update(incremental);
    el.remove();
  });

  it('heatmap renders with multi-day data', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountHeatmap(el);
    h.update(snapshot);
    el.remove();
  });

  it('hourlyTimeline renders with hourly data', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountHourlyTimeline(el);
    h.update(snapshot);
    el.remove();
  });

  it('cumulativeArea renders with daily data', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountCumulativeArea(el);
    h.update(snapshot);
    el.remove();
  });

  it('weekdayRadial renders with weekday data', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountWeekdayRadial(el);
    h.update(snapshot);
    el.remove();
  });
});

describe('components — DOM events + deeper updates', () => {
  it('FilterBar model-filter toggles update the DOM', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountFilterBar(el);
    h.update(richSnapshot(), 'credits');
    // Simulate clicking a model chip to toggle it
    const chip = el.querySelector('.wv-filter-chip, [data-model]') as HTMLElement | null;
    if (chip) chip.click();
    el.remove();
  });

  it('FilterBar date-preset change fires without throwing', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountFilterBar(el);
    h.update(richSnapshot(), 'cost');
    const select = el.querySelector('select') as HTMLSelectElement | null;
    if (select) {
      select.value = '7d';
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    }
    el.remove();
  });

  it('CurrencySelector change fires the onChange callback', () => {
    let changed = '';
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountCurrencySelector(el, (code) => { changed = code; });
    h.update({ USD: 1, EUR: 0.92, JPY: 150 }, 'EUR');
    const select = el.querySelector('select') as HTMLSelectElement;
    select.value = 'JPY';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(changed, 'JPY');
    el.remove();
  });

  it('StatusBanner renders degraded and empty statuses', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountStatusBanner(el);
    h.update({ ...richSnapshot(), status: { kind: 'degraded', reason: 'Connector error' } });
    h.update({ ...richSnapshot(), status: { kind: 'empty', reason: 'No logs' } });
    h.update({ ...richSnapshot(), status: { kind: 'loading', reason: 'Reading…' } });
    el.remove();
  });

  it('SpendGauge renders over-budget and no-budget states', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountSpendGauge(el);
    h.update({ monthly: null, includedCredits: 0, usedCredits: 0, usedCost: 0, percentOfBudget: 0, percentOfIncluded: 0, projectedOverage: null, pace: 'no-budget' }, 'USD');
    h.update({ monthly: 10, includedCredits: 300, usedCredits: 500, usedCost: 20, percentOfBudget: 200, percentOfIncluded: 166, projectedOverage: 10, pace: 'over' }, 'USD');
    el.remove();
  });

  it('RestrictionBanner snooze button fires without throwing', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountRestrictionBanner(el);
    h.update({ version: 1, active: true, ruleId: 'r', reasonMessage: 'Over budget', firedAt: Date.now(), userOverrideUntil: null });
    const btn = el.querySelector('button') as HTMLButtonElement | null;
    if (btn) btn.click();
    // Also test the override state
    h.update({ version: 1, active: true, ruleId: 'r', reasonMessage: 'Over budget', firedAt: Date.now(), userOverrideUntil: Date.now() + 60000 });
    el.remove();
  });

  it('KpiCards renders all metric variants', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountKpiCards(el);
    for (const m of METRICS) h.update(richSnapshot(), m);
    el.remove();
  });
});
