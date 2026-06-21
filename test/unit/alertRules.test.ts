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
  it('returns ok: true for a valid document with JSON condition', () => {
    const result = parseAlertRules({
      version: 1,
      rules: [{ id: 'r1', severity: 'warning', message: 'hi', when: { '>': [{ var: 'today.credits' }, 10] } }],
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
      groups: [{ id: 'g1', active: true, label: 'Group 1' }],
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
      { id: 'r', severity: 'warning', message: '', when: { '>': [{ var: 'today.credits' }, 0] }, active: { var: 'group.g1' } },
    ];
    const groups = [{ id: 'g1', active: false as const }];
    const fired = new Map<string, number>();
    const out = evaluateAlertRules({ snapshot: snap(100), rules, groups, fired, now });
    assert.equal(out.length, 0, 'group inactive suppresses rule');
  });

  it('group active=true allows rule to fire', () => {
    const rules: AlertRule[] = [
      { id: 'r', severity: 'warning', message: '', when: { '>': [{ var: 'today.credits' }, 0] }, active: { var: 'group.g1' } },
    ];
    const groups = [{ id: 'g1', active: true as const }];
    const fired = new Map<string, number>();
    const out = evaluateAlertRules({ snapshot: snap(100), rules, groups, fired, now });
    assert.equal(out.length, 1);
  });

  it('compound condition fires when both sides true', () => {
    const rules: AlertRule[] = [
      {
        id: 'r',
        severity: 'info',
        message: '',
        when: { 'and': [
          { '>': [{ var: 'today.credits' }, 50] },
          { '<': [{ var: 'budget.percentOfBudget' }, 1] },
        ] },
      },
    ];
    const fired = new Map<string, number>();
    const out = evaluateAlertRules({ snapshot: snap(60), rules, fired, now });
    assert.equal(out.length, 1);
  });

  it('template renders {{field.path}} using the rule context', () => {
    const rules: AlertRule[] = [
      {
        id: 'r',
        severity: 'info',
        message: 'Credits: {{today.credits}}',
        when: { '>': [{ var: 'today.credits' }, 0] },
      },
    ];
    const fired = new Map<string, number>();
    const out = evaluateAlertRules({ snapshot: snap(42), rules, fired, now });
    assert.equal(out[0]?.message, 'Credits: 42');
  });
});

describe('alertRules — conditions shorthand', () => {
  const now = Date.now();
  it('fires when conditions array matches', () => {
    const rules: AlertRule[] = [{
      id: 'r', severity: 'warning', message: '',
      conditions: [{ field: 'today.credits', op: '>', value: 50 }],
    }];
    const out = evaluateAlertRules({ snapshot: snap(60), rules, fired: new Map(), now });
    assert.equal(out.length, 1);
  });

  it('does not fire when conditions do not match', () => {
    const rules: AlertRule[] = [{
      id: 'r', severity: 'warning', message: '',
      conditions: [{ field: 'today.credits', op: '>', value: 100 }],
    }];
    const out = evaluateAlertRules({ snapshot: snap(60), rules, fired: new Map(), now });
    assert.equal(out.length, 0);
  });

  it('match:any fires when at least one condition matches', () => {
    const rules: AlertRule[] = [{
      id: 'r', severity: 'info', message: '',
      conditions: [
        { field: 'today.credits', op: '>', value: 999 },
        { field: 'today.credits', op: '>', value: 10 },
      ],
      match: 'any',
    }];
    const out = evaluateAlertRules({ snapshot: snap(60), rules, fired: new Map(), now });
    assert.equal(out.length, 1);
  });
});

describe('alertRules — snooze', () => {
  const now = Date.now();
  it('suppresses a snoozed rule', () => {
    const futureIso = new Date(now + 60_000).toISOString();
    const rules: AlertRule[] = [{
      id: 'r', severity: 'warning', message: '',
      when: { '>': [{ var: 'today.credits' }, 0] },
      snoozeUntil: futureIso,
    }];
    const out = evaluateAlertRules({ snapshot: snap(60), rules, fired: new Map(), now });
    assert.equal(out.length, 0);
  });

  it('fires after snooze has expired', () => {
    const pastIso = new Date(now - 60_000).toISOString();
    const rules: AlertRule[] = [{
      id: 'r', severity: 'warning', message: '',
      when: { '>': [{ var: 'today.credits' }, 0] },
      snoozeUntil: pastIso,
    }];
    const out = evaluateAlertRules({ snapshot: snap(60), rules, fired: new Map(), now });
    assert.equal(out.length, 1);
  });
});

describe('alertRules — threshold escalation', () => {
  const now = Date.now();
  it('fires the highest matching severity', () => {
    const rules: AlertRule[] = [{
      id: 'r', severity: 'info', message: 'spend {{today.credits}}',
      thresholds: [
        { field: 'today.credits', op: '>', value: 50, severity: 'info' },
        { field: 'today.credits', op: '>', value: 80, severity: 'warning' },
        { field: 'today.credits', op: '>', value: 100, severity: 'critical' },
      ],
    }];
    const out = evaluateAlertRules({ snapshot: snap(90), rules, fired: new Map(), now });
    assert.equal(out.length, 1);
    assert.equal(out[0]?.severity, 'warning');
  });

  it('does not fire when no threshold matches', () => {
    const rules: AlertRule[] = [{
      id: 'r', severity: 'info', message: '',
      thresholds: [{ field: 'today.credits', op: '>', value: 200, severity: 'info' }],
    }];
    const out = evaluateAlertRules({ snapshot: snap(60), rules, fired: new Map(), now });
    assert.equal(out.length, 0);
  });
});
