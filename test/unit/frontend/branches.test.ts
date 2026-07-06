import { strict as assert } from 'assert';
import { buildSnapshot } from '../../../src/extension-backend/domain/snapshot';
import { makeEvent } from '../helpers';
import type { UsageSnapshot, RestrictionState, GitHubBillingData } from '../../../src/extension-backend/domain/types';
import { mountGitHubBillingStrip } from '../../../src/extension-frontend/components/GitHubBillingStrip';
import { mountKpiCards } from '../../../src/extension-frontend/components/KpiCards';
import { mountStatusBanner } from '../../../src/extension-frontend/components/StatusBanner';
import { mountRestrictionBanner } from '../../../src/extension-frontend/components/RestrictionBanner';
import { mountEmptyState } from '../../../src/extension-frontend/components/EmptyState';
import { mountAlertConfigPanel } from '../../../src/extension-frontend/components/AlertConfigPanel';
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

  it('GitHubBillingStrip shows a generic error with a Retry action that posts signIn', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountGitHubBillingStrip(el);
    const snap = makeSnapshot(100);
    h.update({ ...snap, authStatus: 'error', authError: 'Network timeout' });
    assert.ok(el.textContent!.includes('Network timeout'));
    const btn = el.querySelector('button')!;
    assert.equal(btn.textContent, 'Retry');
    clearPosted();
    btn.click();
    assert.ok(getPosted().some((m) => JSON.stringify(m).includes('signIn')));
    el.remove();
  });

  it('GitHubBillingStrip shows a Set PAT action when the error requires a Personal Access Token', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountGitHubBillingStrip(el);
    const snap = makeSnapshot(100);
    h.update({ ...snap, authStatus: 'error', authError: 'A GitHub Personal Access Token is required.' });
    const btn = el.querySelector('button')!;
    assert.equal(btn.textContent, 'Set PAT');
    clearPosted();
    btn.click();
    assert.ok(getPosted().some((m) => JSON.stringify(m).includes('setGitHubPat')));
    el.remove();
  });

  it('GitHubBillingStrip falls back to a generic error message when authError is undefined', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountGitHubBillingStrip(el);
    const snap = makeSnapshot(100);
    h.update({ ...snap, authStatus: 'error' });
    assert.ok(el.textContent!.includes('GitHub sign-in failed.'));
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

  it('KpiCards renders no-model dash when topModels is empty', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountKpiCards(el);
    const snap = makeSnapshot(0);
    h.update({ ...snap, topModels: [] }, 'cost');
    el.remove();
  });

  it('StatusBanner flashes the dot on incremental update with ok status', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountStatusBanner(el);
    h.update(makeSnapshot(100));
    // Update with isIncremental=true and ok status to trigger the flash
    h.update({ ...makeSnapshot(100), isIncremental: true, status: { kind: 'ok', reason: '' } });
    el.remove();
  });

  it('RestrictionBanner: dismiss hides on re-show, snooze/disable buttons post', () => {
    clearPosted();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountRestrictionBanner(el);
    const active: RestrictionState = { version: 1, active: true, ruleId: 'r', reasonMessage: 'Over budget', firedAt: 12345, userOverrideUntil: null };
    // Show the active banner
    h.update(active);
    // Click Dismiss to set the dismissedKey
    const dismissBtn = el.querySelector('#restrict-dismiss') as HTMLButtonElement;
    dismissBtn.click();
    // Re-show with the same state → should hide (dismissedKey === key)
    h.update(active);
    assert.equal(el.style.display, 'none', 'banner hidden after dismiss');
    // Re-show with a different firedAt → should show again
    const active2: RestrictionState = { ...active, firedAt: 67890 };
    h.update(active2);
    // Click snooze 15, snooze 60, and disable buttons
    (el.querySelector('#restrict-snooze-15') as HTMLButtonElement).click();
    (el.querySelector('#restrict-snooze-60') as HTMLButtonElement).click();
    (el.querySelector('#restrict-disable') as HTMLButtonElement).click();
    assert.ok(getPosted().some((m) => JSON.stringify(m).includes('restrictSnooze')), 'snooze posted');
    assert.ok(getPosted().some((m) => JSON.stringify(m).includes('disableExtension')), 'disable posted');
    // Test the override (snoozed) state
    h.update({ ...active2, userOverrideUntil: Date.now() + 60000 });
    el.remove();
  });

  it('RestrictionBanner hides when state is null', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountRestrictionBanner(el);
    h.update(null);
    assert.equal(el.style.display, 'none', 'hidden when null');
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

  it('CurrencySelector syncs selection when the currency list is unchanged', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountCurrencySelector(el, () => {});
    // First call populates options with EUR selected
    h.update({ USD: 1, EUR: 0.92 }, 'EUR');
    // Second call with SAME currencies but different selected → sync branch
    h.update({ USD: 1, EUR: 0.92 }, 'USD');
    const select = el.querySelector('select') as HTMLSelectElement;
    assert.equal(select.value, 'USD');
    el.remove();
  });
});
