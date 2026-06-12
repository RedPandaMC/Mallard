import * as assert from 'assert';
import { evaluateRules, NotificationRule, parseWindowMs } from '../../src/notify/rules';
import { startOf } from '../../src/util/time';
import { makeEvent } from './helpers';

const NOW = 1_700_000_000_000;

describe('parseWindowMs', () => {
  it('parses seconds/minutes/hours/days', () => {
    assert.strictEqual(parseWindowMs('30s'), 30_000);
    assert.strictEqual(parseWindowMs('15m'), 900_000);
    assert.strictEqual(parseWindowMs('2h'), 7_200_000);
    assert.strictEqual(parseWindowMs('1d'), 86_400_000);
  });

  it('defaults to one hour for missing or malformed input', () => {
    assert.strictEqual(parseWindowMs(undefined), 3_600_000);
    assert.strictEqual(parseWindowMs('garbage'), 3_600_000);
    assert.strictEqual(parseWindowMs(''), 3_600_000);
  });
});

describe('evaluateRules', () => {
  it('fires a threshold rule once the scoped total crosses the value', () => {
    const dayStart = startOf(NOW, 'day');
    const events = [
      makeEvent({ id: 'a', ts: dayStart + 1000, cost: 3 }),
      makeEvent({ id: 'b', ts: dayStart + 2000, cost: 3 }),
    ];
    const rules: NotificationRule[] = [
      { id: 'daily-cost', type: 'threshold', metric: 'cost', scope: 'day', value: 5 },
    ];
    const alerts = evaluateRules(events, rules, NOW, 'USD');
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0].ruleId, 'daily-cost');
    assert.strictEqual(alerts[0].actual, 6);
  });

  it('does not fire a threshold rule below the value', () => {
    const dayStart = startOf(NOW, 'day');
    const events = [makeEvent({ id: 'a', ts: dayStart + 1000, cost: 2 })];
    const rules: NotificationRule[] = [
      { id: 'daily-cost', type: 'threshold', metric: 'cost', scope: 'day', value: 5 },
    ];
    assert.strictEqual(evaluateRules(events, rules, NOW, 'USD').length, 0);
  });

  it('ignores events outside the threshold scope window', () => {
    const dayStart = startOf(NOW, 'day');
    const events = [
      makeEvent({ id: 'yesterday', ts: dayStart - 5000, cost: 100 }),
      makeEvent({ id: 'today', ts: dayStart + 1000, cost: 1 }),
    ];
    const rules: NotificationRule[] = [
      { id: 'daily-cost', type: 'threshold', metric: 'cost', scope: 'day', value: 5 },
    ];
    assert.strictEqual(evaluateRules(events, rules, NOW, 'USD').length, 0);
  });

  it('fires a velocity rule based on a rolling window', () => {
    const events = [
      makeEvent({ id: 'a', ts: NOW - 10 * 60_000, credits: 30 }), // within 1h
      makeEvent({ id: 'b', ts: NOW - 90 * 60_000, credits: 30 }), // outside 1h
    ];
    const rules: NotificationRule[] = [
      { id: 'burn', type: 'velocity', metric: 'credits', window: '1h', value: 25 },
    ];
    const alerts = evaluateRules(events, rules, NOW, 'USD');
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0].actual, 30);
  });

  it('applies a rule filter so it only counts matching events', () => {
    const dayStart = startOf(NOW, 'day');
    const events = [
      makeEvent({ id: 'pricey', ts: dayStart + 1000, modelId: 'o3', credits: 8 }),
      makeEvent({ id: 'cheap', ts: dayStart + 2000, modelId: 'gpt-4o-mini', credits: 8 }),
    ];
    const rules: NotificationRule[] = [
      {
        id: 'o3-only',
        type: 'threshold',
        metric: 'credits',
        scope: 'day',
        value: 5,
        filter: { models: ['o3'] },
      },
    ];
    const alerts = evaluateRules(events, rules, NOW, 'USD');
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0].actual, 8); // only the o3 event counted
  });

  it('honours the channel and defaults to toast', () => {
    const dayStart = startOf(NOW, 'day');
    const events = [makeEvent({ id: 'a', ts: dayStart + 1000, cost: 10 })];
    const rules: NotificationRule[] = [
      { id: 'status', type: 'threshold', metric: 'cost', scope: 'day', value: 5, channel: 'status-only' },
      { id: 'toast', type: 'threshold', metric: 'cost', scope: 'day', value: 5 },
    ];
    const alerts = evaluateRules(events, rules, NOW, 'USD');
    assert.strictEqual(alerts.find((a) => a.ruleId === 'status')!.channel, 'status-only');
    assert.strictEqual(alerts.find((a) => a.ruleId === 'toast')!.channel, 'toast');
  });

  it('skips rules without a numeric value', () => {
    const events = [makeEvent({ id: 'a', ts: NOW, cost: 10 })];
    const rules = [{ id: 'broken', type: 'threshold', metric: 'cost', scope: 'day' }] as never;
    assert.strictEqual(evaluateRules(events, rules, NOW, 'USD').length, 0);
  });
});
