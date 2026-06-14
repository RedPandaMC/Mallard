import * as assert from 'assert';
import { evaluateAlertRules } from '../../src/domain/alertRules';
import { AlertRule, UsageSnapshot } from '../../src/domain/types';

function snap(percentOfBudget: number, todayCredits: number, todayCost = 0): UsageSnapshot {
  return {
    budget: { percentOfBudget, usedCost: 0, usedCredits: 0 } as UsageSnapshot['budget'],
    today: { credits: todayCredits, cost: todayCost, tokens: 0 },
    forecast: {
      projectedCredits: 0,
      projectedCost: 0,
      low: 0,
      high: 0,
      basis: 'insufficient-data',
      granularity: 'month',
      asOf: 0,
    },
  } as UsageSnapshot;
}

describe('evaluateAlertRules', () => {
  const now = Date.now();
  const fired = new Map<string, number>();

  it('fires nothing with no rules', () => {
    const out = evaluateAlertRules({ snapshot: snap(0, 0), rules: [], fired, now });
    assert.equal(out.length, 0);
  });

  it('fires when the `when` expression matches', () => {
    const rules: AlertRule[] = [
      {
        id: 'daily-50',
        severity: 'warning',
        message: 'Daily 50',
        when: 'today.credits >= 50',
      },
    ];
    const out = evaluateAlertRules({ snapshot: snap(0, 60), rules, fired, now });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.ruleId, 'daily-50');
  });

  it('respects cooldown', () => {
    const rules: AlertRule[] = [
      { id: 'r1', severity: 'warning', cooldown: '4h', message: '', when: 'today.credits > 0' },
    ];
    const f = new Map<string, number>();
    const a = evaluateAlertRules({ snapshot: snap(0, 100), rules, fired: f, now });
    assert.equal(a.length, 1);
    const b = evaluateAlertRules({ snapshot: snap(0, 100), rules, fired: f, now: now + 60_000 });
    assert.equal(b.length, 0, 'within cooldown');
    const c = evaluateAlertRules({
      snapshot: snap(0, 100),
      rules,
      fired: f,
      now: now + 5 * 60 * 60 * 1000,
    });
    assert.equal(c.length, 1, 'after cooldown');
  });

  it('skips when `active` is false', () => {
    const rules: AlertRule[] = [
      {
        id: 'r1',
        severity: 'warning',
        message: '',
        when: 'today.credits > 0',
        active: 'now.weekday == 0',
      },
    ];
    const out = evaluateAlertRules({ snapshot: snap(0, 100), rules, fired, now });
    // weekday 0 (Sunday) only matches on Sundays; the test runs on an arbitrary day
    const today = new Date(now).getDay();
    if (today !== 0) assert.equal(out.length, 0);
  });

  it('honours `requiresAuth`', () => {
    const rules: AlertRule[] = [
      {
        id: 'auth',
        severity: 'warning',
        requiresAuth: true,
        message: '',
        when: 'today.credits > 0',
      },
    ];
    const out = evaluateAlertRules({ snapshot: snap(0, 100), rules, fired, now, signedIn: false });
    assert.equal(out.length, 0);
  });

  it('renders the `message` template', () => {
    const rules: AlertRule[] = [
      {
        id: 'r',
        severity: 'info',
        message: 'Used {{today.credits}} credits',
        when: 'today.credits > 0',
      },
    ];
    const out = evaluateAlertRules({ snapshot: snap(0, 73), rules, fired, now });
    assert.equal(out[0]!.message, 'Used 73 credits');
  });

  it('per-rule `derived` values land in the context', () => {
    const rules: AlertRule[] = [
      {
        id: 'r',
        severity: 'warning',
        message: '{{premiumShare}}',
        when: 'premiumShare > 0.5',
        derived: { premiumShare: 'today.credits / 100' },
      },
    ];
    const out = evaluateAlertRules({ snapshot: snap(0, 80), rules, fired, now });
    assert.equal(out.length, 1);
  });

  it('skips rules with a malformed `when`', () => {
    const rules: AlertRule[] = [
      { id: 'r', severity: 'warning', message: '', when: 'this is not valid +' },
    ];
    const out = evaluateAlertRules({ snapshot: snap(0, 100), rules, fired, now });
    assert.equal(out.length, 0);
  });

  it('per-severity cooldown keys are independent', () => {
    const rules: AlertRule[] = [
      { id: 'shared', severity: 'warning', cooldown: '1h', message: '', when: 'today.credits > 0' },
      {
        id: 'shared',
        severity: 'critical',
        cooldown: '1h',
        message: '',
        when: 'today.credits > 0',
      },
    ];
    const f = new Map<string, number>();
    const a = evaluateAlertRules({ snapshot: snap(0, 100), rules, fired: f, now });
    assert.equal(a.length, 2, 'both severities fire');
  });
});
