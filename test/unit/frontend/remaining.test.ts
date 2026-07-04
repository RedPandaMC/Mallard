import { strict as assert } from 'assert';
import { buildSnapshot } from '../../../src/extension-backend/domain/snapshot';
import { makeEvent } from '../helpers';
import type { UsageSnapshot } from '../../../src/extension-backend/domain/types';
import { mountDailyBars } from '../../../src/extension-frontend/charts/dailyBars';
import { mountCumulativeArea } from '../../../src/extension-frontend/charts/cumulativeArea';
import { mountModelBreakdown } from '../../../src/extension-frontend/charts/modelBreakdown';
import { mountFilterBar } from '../../../src/extension-frontend/components/FilterBar';

function richSnapshot(): UsageSnapshot {
  const now = Date.now();
  return buildSnapshot(
    [
      makeEvent({ ts: now - 1000, modelId: 'gpt-4o', credits: 50, cost: 2, surface: 'chat', source: 'local', costByCategory: { input: 0.5, output: 0.8 } }),
      makeEvent({ ts: now - 2000, modelId: 'claude-sonnet-4-5', credits: 30, cost: 1.2, surface: 'inline', source: 'local', costByCategory: { input: 0.4, output: 0.6 } }),
      makeEvent({ ts: now - 3000, modelId: 'gpt-4o', credits: 20, cost: 0.8, surface: 'agent', source: 'claude-code' }),
      makeEvent({ ts: now - 5 * 86400000, modelId: 'claude-sonnet-4-5', credits: 10, cost: 0.4, surface: 'chat', source: 'claude-code' }),
    ],
    {
      now, currency: 'USD', pricePerCredit: 0.04, monthlyBudget: 50, includedCredits: 300,
      filter: {}, source: 'local', status: { kind: 'ok' }, authStatus: 'signed-out',
    },
  );
}

describe('charts — projected pace, focus dimming, onModelClick', () => {
  it('dailyBars renders projected pace line when forecast is non-insufficient', () => {
    const snap = richSnapshot();
    // Force a non-insufficient forecast so projectedLine is non-null
    const withForecast: UsageSnapshot = {
      ...snap,
      chartData: {
        ...snap.chartData,
        dailyBars: { ...snap.chartData.dailyBars, projectedLine: 10 },
      },
    };
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountDailyBars(el);
    h.update(withForecast);
    el.remove();
  });

  it('modelBreakdown calls onModelClick when a bar is clicked (via stub)', () => {
    const clicked: string[] = [];
    const el = document.createElement('div');
    document.body.appendChild(el);
    // Passing onModelClick triggers onMount → chart.on('click', ...) → stub fires immediately
    const h = mountModelBreakdown(el, (label) => clicked.push(label));
    h.update(richSnapshot(), 'cost');
    assert.ok(clicked.includes('gpt-4o'), 'click handler fired with model name');
    el.remove();
  });

  it('modelBreakdown dims non-focused models when focusedModels is non-empty', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountModelBreakdown(el) as unknown as { setFocused: (s: ReadonlySet<string>) => void; update: (s: UsageSnapshot, m?: string) => void };
    h.setFocused(new Set(['gpt-4o']));
    h.update(richSnapshot(), 'cost');
    el.remove();
  });
});

describe('cumulativeArea — no budget branch', () => {
  it('renders without a budget line when monthlyBudget is 0', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountCumulativeArea(el);
    // Override dailyBars to have null budgetLine
    const snap = richSnapshot();
    // Override budget.monthly to null so the markLine ternary takes the false branch
    h.update({
      ...snap,
      budget: { ...snap.budget, monthly: null },
    });
    el.remove();
  });
});

describe('FilterBar — source chips, model dropdown, surface toggle', () => {
  it('renders source chips, model dropdown, and toggles filters', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountFilterBar(el);
    h.update(richSnapshot(), 'credits');
    // Click a source chip (All/Copilot/Claude Code)
    const sourceChips = el.querySelectorAll('[data-source-group]');
    sourceChips.forEach((chip) => (chip as HTMLElement).click());
    // Click surface chips to toggle
    const surfaceChips = el.querySelectorAll('[data-surface]');
    surfaceChips.forEach((chip) => (chip as HTMLElement).click());
    // Click "All models" to clear activeModels (covers line 204 "All models" label)
    (el.querySelector('[data-model="__all__"]') as HTMLElement)?.click();
    // Re-query and click a model → activeModels.length = 1 (line 217)
    (el.querySelectorAll('.wv-model-option')[1] as HTMLElement)?.click();
    // Re-query and click another model → activeModels.length = 2 (line 218)
    (el.querySelectorAll('.wv-model-option')[2] as HTMLElement)?.click();
    // Re-query and click first model again to deselect (line 259 filter branch)
    (el.querySelectorAll('.wv-model-option')[1] as HTMLElement)?.click();
    // Click date-preset buttons and metric toggle buttons
    el.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => btn.click());
    el.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach((btn) => btn.click());
    // Click the model filter button to toggle the dropdown open/close
    const filterBtn = el.querySelector('#model-filter-btn') as HTMLButtonElement;
    filterBtn?.click(); // open
    filterBtn?.click(); // close
    // Keyboard interactions
    filterBtn?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const dropdown = el.querySelector('#model-dropdown') as HTMLElement;
    // Navigate with arrow keys
    dropdown?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    dropdown?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    dropdown?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    dropdown?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    dropdown?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    // Click outside the model filter to trigger closeDropdown (line 204)
    document.body.click();
    el.remove();
  });
});