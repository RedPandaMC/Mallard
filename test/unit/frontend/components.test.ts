import { strict as assert } from 'assert';
import { buildSnapshot } from '../snapshotFixture';
import { makeEvent } from '../helpers';
import type { UsageSnapshot, Metric, RestrictionState, AuthStatus } from '../../../src/extension-backend/domain/types';
import { DEFAULT_USER_CONFIG } from '../../../src/extension-backend/domain/types';
import { mountKpiCards } from '../../../src/extension-frontend/components/KpiCards';
import { mountFilterBar } from '../../../src/extension-frontend/components/FilterBar';
import { mountGitHubBillingStrip } from '../../../src/extension-frontend/components/GitHubBillingStrip';
import { mountRestrictionBanner } from '../../../src/extension-frontend/components/RestrictionBanner';
import { mountStatusBanner } from '../../../src/extension-frontend/components/StatusBanner';
import { mountEmptyState } from '../../../src/extension-frontend/components/EmptyState';
import { mountAlertConfigPanel } from '../../../src/extension-frontend/components/AlertConfigPanel';
import { mountCurrencySelector } from '../../../src/extension-frontend/components/CurrencySelector';

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

describe('components — mount + update DOM', () => {
  const snapshot = makeSnapshot(100);

  it('KpiCards renders value cells and updates with a metric', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountKpiCards(el);
    h.update(snapshot, 'credits' as Metric);
    assert.ok(el.querySelector('.wv-kpi-grid'), 'kpi grid rendered');
    assert.ok(el.querySelectorAll('.wv-kpi-card').length >= 3, 'at least 3 cards');
    el.remove();
  });

  it('FilterBar renders and updates with a snapshot + metric', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountFilterBar(el);
    h.update(snapshot, 'cost' as Metric);
    assert.ok(el.children.length > 0);
    el.remove();
  });

  it('FilterBar shows a single informational source chip when only one connector has data', () => {
    const now = Date.now();
    const single = buildSnapshot(
      [makeEvent({ ts: now - 1000, modelId: 'claude-sonnet-4', source: 'claude-code', credits: 10, cost: 0.4 })],
      {
        now, currency: 'USD', pricePerCredit: 0.04, monthlyBudget: 50, includedCredits: 300,
        filter: {}, source: 'local', status: { kind: 'ok' }, authStatus: 'signed-out',
      },
    );
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountFilterBar(el);
    h.update(single, 'cost' as Metric);
    const group = el.querySelector('#source-chip-group') as HTMLElement;
    assert.equal(group.hidden, false, 'source chip group visible for a single connector');
    const info = el.querySelectorAll('.wv-source-chip--info');
    assert.equal(info.length, 1);
    assert.equal(info[0]!.textContent, 'Claude Code');
    assert.equal(el.querySelectorAll('[data-source-group]').length, 0, 'no interactive chips for one source');
    el.remove();
  });

  it('FilterBar hides the source chip group when no source has data yet', () => {
    const now = Date.now();
    const empty = buildSnapshot([], {
      now, currency: 'USD', pricePerCredit: 0.04, monthlyBudget: 50, includedCredits: 300,
      filter: {}, source: 'local', status: { kind: 'empty' }, authStatus: 'signed-out',
    });
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountFilterBar(el);
    h.update(empty, 'cost' as Metric);
    const group = el.querySelector('#source-chip-group') as HTMLElement;
    assert.equal(group.hidden, true);
    el.remove();
  });

  it('GitHubBillingStrip renders nothing when signed out, content when signed in', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountGitHubBillingStrip(el);
    h.update(snapshot); // signed-out
    const signedIn = { ...snapshot, authStatus: 'signed-in' as AuthStatus, githubBilling: { quota: null, items: [], fetchedAt: Date.now(), totalNetAmount: 0 } };
    h.update(signedIn);
    el.remove();
  });

  it('GitHubBillingStrip converts USD billing amounts to the display currency before rendering and comparing', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountGitHubBillingStrip(el);
    const base = makeSnapshot(100);
    const signedIn = {
      ...base,
      currency: 'EUR',
      fxRates: { USD: 1, EUR: 2 },
      // usedCost is already display-currency (EUR); totalNetAmount is USD.
      budget: { ...base.budget, usedCost: 20 },
      authStatus: 'signed-in' as AuthStatus,
      githubBilling: { quota: null, items: [], fetchedAt: Date.now(), totalNetAmount: 10 },
    };
    h.update(signedIn);
    const amount = el.querySelector('.wv-gh-amount');
    assert.ok(amount?.textContent?.includes('20'), `renders 10 USD × 2 = 20 EUR, got "${amount?.textContent}"`);
    assert.equal(
      el.querySelector('.wv-gh-divergence'),
      null,
      '20 EUR local vs 10 USD (= 20 EUR) actual must not warn',
    );
    // A genuine divergence still warns.
    h.update({ ...signedIn, budget: { ...base.budget, usedCost: 100 } });
    assert.ok(el.querySelector('.wv-gh-divergence'), 'real divergence still warns');
    el.remove();
  });

  it('RestrictionBanner shows/hides based on state', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountRestrictionBanner(el);
    h.update(null);
    const active: RestrictionState = { version: 1, active: true, ruleId: 'r', reasonMessage: 'Over budget', firedAt: Date.now(), userOverrideUntil: null };
    h.update(active);
    h.update({ ...active, userOverrideUntil: Date.now() + 60000 });
    el.remove();
  });

  it('StatusBanner renders the snapshot status', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountStatusBanner(el);
    h.update(snapshot);
    assert.ok(el.children.length > 0);
    el.remove();
  });

  it('EmptyState shows/hides with a reason', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountEmptyState(el);
    h.update(true, 'No data yet');
    h.update(false);
    el.remove();
  });

  it('AlertConfigPanel renders and updates with a UserConfig', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountAlertConfigPanel(el);
    h.update(DEFAULT_USER_CONFIG);
    assert.ok(el.children.length > 0);
    el.remove();
  });

  it('CurrencySelector renders options and updates with rates + selected', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountCurrencySelector(el, () => {});
    h.update({ USD: 1, EUR: 0.92 }, 'EUR');
    assert.ok(el.children.length > 0);
    el.remove();
  });
});
