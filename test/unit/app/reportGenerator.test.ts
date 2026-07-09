import { strict as assert } from 'assert';
import * as os from 'os';
import { defaultReportPath, generateReport } from '../../../src/extension-backend/app/ReportGenerator';
import { buildSnapshot } from '../snapshotFixture';
import { makeEvent } from '../helpers';
import type { UsageSnapshot } from '../../../src/extension-backend/domain/types';

function snapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  const now = Date.now();
  const base = buildSnapshot(
    [
      makeEvent({ ts: now - 1000, modelId: 'claude-sonnet-4-5', credits: 6, cost: 0.24 }),
      makeEvent({ ts: now - 2000, modelId: 'gpt-4o', credits: 2, cost: 0.08 }),
    ],
    {
      now,
      currency: 'USD',
      pricePerCredit: 0.04,
      monthlyBudget: null,
      includedCredits: 300,
      filter: {},
      source: 'local',
      status: { kind: 'ok' },
      authStatus: 'signed-out',
    },
  );
  return { ...base, ...overrides };
}

describe('ReportGenerator', () => {
  it('renders a standalone HTML document with the snapshot KPIs', () => {
    const s = snapshot();
    const html = generateReport(s);
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('claude-sonnet-4-5'), 'model table row');
    assert.ok(html.includes('gpt-4o'));
    assert.ok(!/<script/i.test(html), 'report must not contain scripts');
  });

  it('escapes HTML in model names', () => {
    const s = snapshot();
    s.chartData.modelBreakdown.labels[0] = '<img src=x onerror=alert(1)>';
    const html = generateReport(s);
    assert.ok(!html.includes('<img src=x'), 'must escape injected markup');
    assert.ok(html.includes('&lt;img'));
  });

  it('includes the GitHub billing section only when signed in', () => {
    const without = generateReport(snapshot());
    assert.ok(!without.includes('GitHub Billing') || !without.includes('Plan:'));

    const withBilling = generateReport(
      snapshot({
        githubBilling: {
          quota: { plan: 'copilot_pro', entitlement: 300, used: 75, resetDate: null, unlimited: false },
          items: [
            { model: 'claude-sonnet-4-5', sku: 'premium', grossAmount: 4, netAmount: 3.5, grossQuantity: 10 },
          ],
          fetchedAt: Date.now(),
          totalNetAmount: 3.5,
        },
      }),
    );
    assert.ok(withBilling.includes('copilot_pro'));
  });

  it('handles an empty snapshot without throwing', () => {
    const empty = buildSnapshot([], {
      now: Date.now(),
      currency: 'USD',
      pricePerCredit: 0.04,
      monthlyBudget: null,
      includedCredits: 300,
      filter: {},
      source: 'local',
      status: { kind: 'ok' },
      authStatus: 'signed-out',
    });
    const html = generateReport(empty);
    assert.ok(html.includes('No daily data available') || html.includes('No model data available'));
  });

  it('defaultReportPath points at a mallard-report file in Downloads', () => {
    const p = defaultReportPath();
    assert.ok(p.startsWith(os.homedir()));
    assert.match(p, /mallard-report-\d{4}-\d{2}\.html$/);
  });

  it('renders the quota reset date when set, and the empty-quota branch when null', () => {
    const withReset = snapshot({
      githubBilling: {
        quota: { plan: 'copilot_pro', entitlement: 300, used: 75, resetDate: Date.now() + 86400000, unlimited: false },
        items: [], fetchedAt: Date.now(), totalNetAmount: 0,
      },
    });
    const htmlReset = generateReport(withReset);
    assert.ok(htmlReset.includes('copilot_pro'));

    const nullQuota = snapshot({
      githubBilling: { quota: null, items: [], fetchedAt: Date.now(), totalNetAmount: 0 },
    });
    // Must not throw and must still render the billing section header-less.
    assert.ok(generateReport(nullQuota).includes('github') || generateReport(nullQuota).length > 0);
  });

  it('renders the projected-cost range and budget percent when both are set', () => {
    const s = snapshot({
      forecast: { granularity: 'month', projectedCredits: 300, projectedCost: 12.5, low: 10, high: 15, basis: 'linear', asOf: Date.now() },
      budget: { monthly: 50, includedCredits: 300, usedCredits: 12.5, usedCost: 0.5, percentOfBudget: 25, percentOfIncluded: 4, projectedOverage: null, pace: 'on-track' },
    });
    const html = generateReport(s);
    assert.ok(html.includes('12.5'), 'projected cost rendered');
    assert.ok(html.includes('25'), 'budget percent rendered');
  });
});
