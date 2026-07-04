import { strict as assert } from 'assert';
import * as os from 'os';
import { defaultReportPath, generateReport } from '../../../src/extension-backend/app/ReportGenerator';
import { buildSnapshot } from '../../../src/extension-backend/domain/snapshot';
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
});
