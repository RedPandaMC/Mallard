import * as assert from 'assert';
import { parseAlertRules, evaluateAlertRules } from '../../src/domain/alertRules';
import { AlertRule, UsageSnapshot } from '../../src/domain/types';

function snap(todayCredits = 0): UsageSnapshot {
  return {
    budget: { percentOfBudget: 0, usedCost: 0, usedCredits: 0 } as UsageSnapshot['budget'],
    today: { credits: todayCredits, cost: 0, tokens: 0 },
    forecast: { projectedCredits: 0, projectedCost: 0, low: 0, high: 0, basis: 'insufficient-data', granularity: 'month', asOf: 0 },
  } as UsageSnapshot;
}

describe('parseAlertRules', () => {
  it('returns ok: true for a valid document', () => {
    const result = parseAlertRules({
      version: 1,
      rules: [{ id: 'r1', severity: 'warning', message: 'hi', when: 'today.credits > 10' }],
    });
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.doc.rules[0]?.id, 'r1');
  });

  it('returns ok: false for a completely invalid document', () => {
    const result = parseAlertRules('not an object');
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
  });

  it('returns ok: false when rules array is malformed', () => {
    const result = parseAlertRules({ version: 1, rules: 'bad' });
    assert.equal(result.ok, false);
  });

  it('preserves vars and groups from the document', () => {
    const result = parseAlertRules({
      version: 2,
      vars: { threshold: 50 },
      groups: [{ id: 'g1', active: 'true', label: 'Group 1' }],
      rules: [],
    });
    assert.equal(result.ok, true);
    assert.equal((result.doc.vars as Record<string, number>).threshold, 50);
    assert.equal(result.doc.groups[0]?.id, 'g1');
  });

  it('does not throw on deeply malformed input', () => {
    const inputs = [null, undefined, 123, [], { rules: [{ id: null }] }];
    for (const input of inputs) {
      assert.doesNotThrow(() => parseAlertRules(input));
    }
  });
});

describe('evaluateAlertRules — groups', () => {
  const now = Date.now();

  it('group active=false suppresses rules referencing that group', () => {
    const rules: AlertRule[] = [
      { id: 'r', severity: 'warning', message: '', when: 'today.credits > 0', active: 'group.g1' },
    ];
    const groups = [{ id: 'g1', active: 'false' }];
    const fired = new Map<string, number>();
    const out = evaluateAlertRules({ snapshot: snap(100), rules, groups, fired, now });
    assert.equal(out.length, 0, 'group inactive suppresses rule');
  });

  it('group active=true allows rule to fire', () => {
    const rules: AlertRule[] = [
      { id: 'r', severity: 'warning', message: '', when: 'today.credits > 0', active: 'group.g1' },
    ];
    const groups = [{ id: 'g1', active: 'true' }];
    const fired = new Map<string, number>();
    const out = evaluateAlertRules({ snapshot: snap(100), rules, groups, fired, now });
    assert.equal(out.length, 1);
  });

  it('derived values are available in the when expression', () => {
    const rules: AlertRule[] = [
      {
        id: 'r',
        severity: 'info',
        message: '',
        when: 'doubled > 100',
        derived: { doubled: 'today.credits * 2' },
      },
    ];
    const fired = new Map<string, number>();
    const out = evaluateAlertRules({ snapshot: snap(60), rules, fired, now });
    assert.equal(out.length, 1);
  });

  it('template renders {{expr}} using the rule context', () => {
    const rules: AlertRule[] = [
      {
        id: 'r',
        severity: 'info',
        message: 'Credits: {{today.credits}}',
        when: 'today.credits > 0',
      },
    ];
    const fired = new Map<string, number>();
    const out = evaluateAlertRules({ snapshot: snap(42), rules, fired, now });
    assert.equal(out[0]?.message, 'Credits: 42');
  });
});
