import { strict as assert } from 'assert';
import { buildSnapshot } from '../../../src/extension-backend/domain/snapshot';
import { makeEvent } from '../helpers';
import type { UsageSnapshot, BudgetState, RestrictionState, GitHubBillingData } from '../../../src/extension-backend/domain/types';
import { mountGitHubBillingStrip } from '../../../src/extension-frontend/components/GitHubBillingStrip';
import { mountKpiCards } from '../../../src/extension-frontend/components/KpiCards';
import { mountStatusBanner } from '../../../src/extension-frontend/components/StatusBanner';
import { mountRestrictionBanner } from '../../../src/extension-frontend/components/RestrictionBanner';
import { mountEmptyState } from '../../../src/extension-frontend/components/EmptyState';
import { mountAlertConfigPanel } from '../../../src/extension-frontend/components/AlertConfigPanel';
import { mountSpendGauge } from '../../../src/extension-frontend/components/SpendGauge';
import { mountCurrencySelector } from '../../../src/extension-frontend/components/CurrencySelector';
import { DEFAULT_USER_CONFIG } from '../../../src/extension-backend/domain/types';

function makeSnapshot(credits = 100): UsageSnapshot {
  const now = Date.now();
  return buildSnapshot(
    [makeEvent({ ts: now - 1000, modelId: 'gpt-4o', credits, cost: credits * 0.04 })],
    {
      now, currency: 'USD', pricePerCredit: 0.04, monthlyBudget: 50, includedCredits: 300,
      filter: {}, source: 'local', status: { kind: 'ok' }, authStatus: 'signed-out',
    },
  );
}

function clearPosted() {
  (globalThis as unknown as { __postedMessages: unknown[] }).__postedMessages = [];
}
function getPosted(): unknown[] {
  return (globalThis as unknown as { __postedMessages: unknown[] }).__postedMessages;
}

describe('components — remaining branch coverage', () => {
  it('GitHubBillingStrip renders quota with resetDate and cost divergence warning', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountGitHubBillingStrip(el);
    const snap = makeSnapshot(100);
    const billing: GitHubBillingData = {
      quota: { plan: 'copilot_pro', entitlement: 300, used: 75, resetDate: Date.now() + 86400000, unlimited: false },
      items: [{ model: 'gpt-4o', sku: 'premium', grossAmount: 10, netAmount: 9, grossQuantity: 100 }],
      fetchedAt: Date.now(),
      totalNetAmount: 100, // diverges from localCost to trigger the warning
    };
    h.update({ ...snap, authStatus: 'signed-in', githubBilling: billing });
    assert.ok(el.innerHTML.length > 0);
    el.remove();
  });

  it('GitHubBillingStrip renders quota with null resetDate', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountGitHubBillingStrip(el);
    const snap = makeSnapshot(100);
    h.update({
      ...snap,
      authStatus: 'signed-in',
      githubBilling: { quota: { plan: 'unlimited', entitlement: 0, used: 0, resetDate: null, unlimited: true }, items: [], fetchedAt: Date.now(), totalNetAmount: 0 },
    });
    el.remove();
  });

  it('KpiCards renders projected cost range when forecast is linear', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountKpiCards(el);
    const snap = makeSnapshot(100);
    // Force a non-insufficient-data forecast so the projected-cost branch runs.
    h.update({ ...snap, forecast: { granularity: 'month', projectedCredits: 300, projectedCost: 12.5, low: 10, high: 15, basis: 'linear', asOf: Date.now() } }, 'cost');
    el.remove();
  });

  it('KpiCards renders no-model dash when allModels is empty', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountKpiCards(el);
    const snap = makeSnapshot(0);
    h.update({ ...snap, allModels: [] }, 'cost');
    el.remove();
  });

  it('StatusBanner flashes the dot on status change', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountStatusBanner(el);
    h.update(makeSnapshot(100));
    // Update again with a different status to trigger the flash
    h.update({ ...makeSnapshot(100), status: { kind: 'degraded', reason: 'error' } });
    el.remove();
  });

  it('RestrictionBanner hides when state is null, and snooze buttons post messages', () => {
    clearPosted();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountRestrictionBanner(el);
    // null → hide
    h.update(null);
    // active → show with buttons
    const active: RestrictionState = { version: 1, active: true, ruleId: 'r', reasonMessage: 'Over budget', firedAt: Date.now(), userOverrideUntil: null };
    h.update(active);
    // Click all buttons (snooze 15, snooze 60, disable)
    const buttons = el.querySelectorAll('button');
    buttons.forEach((btn) => btn.click());
    assert.ok(getPosted().some((m) => JSON.stringify(m).includes('restrictSnooze')), 'snooze posted');
    el.remove();
  });

  it('EmptyState buttons post refresh and signIn commands', () => {
    clearPosted();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountEmptyState(el);
    h.update(true, 'No data');
    const buttons = el.querySelectorAll('button');
    buttons.forEach((btn) => btn.click());
    assert.ok(getPosted().some((m) => JSON.stringify(m).includes('refresh')), 'refresh posted');
    el.remove();
  });

  it('AlertConfigPanel button posts openConfig', () => {
    clearPosted();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountAlertConfigPanel(el);
    h.update(DEFAULT_USER_CONFIG);
    const btn = el.querySelector('button');
    if (btn) btn.click();
    assert.ok(getPosted().some((m) => JSON.stringify(m).includes('openConfig')), 'openConfig posted');
    el.remove();
  });

  it('SpendGauge renders warn severity at 80% budget', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountSpendGauge(el);
    const budget: BudgetState = {
      monthly: 100, includedCredits: 300, usedCredits: 80, usedCost: 3.2,
      percentOfBudget: 80, percentOfIncluded: 27, projectedOverage: null, pace: 'warning',
    };
    h.update(budget, 'USD');
    el.remove();
  });

  it('CurrencySelector syncs selection when rates already include the selected code', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountCurrencySelector(el, () => {});
    // First call populates options; second call with same selected syncs.
    h.update({ USD: 1, EUR: 0.92 }, 'EUR');
    h.update({ USD: 1, EUR: 0.92, JPY: 150 }, 'EUR');
    const select = el.querySelector('select') as HTMLSelectElement;
    assert.equal(select.value, 'EUR');
    el.remove();
  });
});
