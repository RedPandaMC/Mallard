/**
 * UsageService domain logic tests — exercises buildSnapshot and the VscodeHost
 * stub without importing the VS Code runtime.
 */
import * as assert from 'assert';
import { makeEvent, makeStubVscodeHost } from './helpers';
import { DEFAULT_USER_CONFIG } from '../../src/domain/types';
import { buildSnapshot } from '../../src/domain/snapshot';

function makeOpts(now: number) {
  return {
    now,
    currency: 'USD',
    pricePerCredit: 0.04,
    monthlyBudget: null,
    includedCredits: 300,
    filter: {},
    source: 'local' as const,
    status: { kind: 'ok' as const },
    authStatus: 'signed-out' as const,
    dimensionEvents: [] as ReturnType<typeof makeEvent>[],
    manifest: { version: 1, pricePerCredit: 0.04, updatedAt: '2026-01-01', models: {} },
  };
}

describe('VscodeHost stub', () => {
  it('records warnings', async () => {
    const host = makeStubVscodeHost();
    await host.showWarningMessage('test warning');
    assert.deepEqual(host.warnings, ['test warning']);
  });

  it('records commands', async () => {
    const host = makeStubVscodeHost();
    await host.executeCommand('mallard.refresh', 1, 2);
    assert.equal(host.commands[0]?.command, 'mallard.refresh');
    assert.deepEqual(host.commands[0]?.args, [1, 2]);
  });

  it('does not throw on repeated calls', async () => {
    const host = makeStubVscodeHost();
    await host.showWarningMessage('a');
    await host.showWarningMessage('b');
    assert.equal(host.warnings.length, 2);
  });
});

describe('buildSnapshot (UsageService core path)', () => {
  it('produces a valid snapshot with events', () => {
    const now = Date.now();
    const events = [makeEvent({ ts: now - 1000, credits: 10 })];
    const snap = buildSnapshot(events, { ...makeOpts(now), dimensionEvents: events });
    assert.ok(snap.generatedAt > 0);
    assert.equal(snap.currency, 'USD');
  });

  it('isIncremental is false on first snapshot (no prevSnapshot)', () => {
    const now = Date.now();
    const events = [makeEvent({ ts: now - 1000, credits: 10 })];
    const snap = buildSnapshot(events, { ...makeOpts(now), dimensionEvents: events });
    assert.equal(snap.isIncremental, false);
  });

  it('isIncremental is true when only today changed since prev', () => {
    const now = Date.now();
    const events = [makeEvent({ ts: now - 1000, credits: 10 })];
    const opts = { ...makeOpts(now), dimensionEvents: events };
    const prev = buildSnapshot(events, opts);
    const next = buildSnapshot([...events, makeEvent({ ts: now - 500, credits: 1 })], {
      ...opts,
      prevSnapshot: prev,
    });
    assert.equal(next.isIncremental, true);
  });

  it('today.credits sums only events from today', () => {
    const now = Date.now();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEvent = makeEvent({ ts: todayStart.getTime() + 1000, credits: 5 });
    const oldEvent = makeEvent({ ts: now - 30 * 24 * 60 * 60 * 1000, credits: 100 });
    const snap = buildSnapshot([todayEvent, oldEvent], {
      ...makeOpts(now),
      dimensionEvents: [todayEvent, oldEvent],
    });
    assert.equal(snap.today.credits, 5);
  });
});

describe('DEFAULT_USER_CONFIG', () => {
  it('has zero monthly budget by default', () => {
    assert.equal(DEFAULT_USER_CONFIG.monthlyBudget, 0);
  });

  it('has 300 included credits', () => {
    assert.equal(DEFAULT_USER_CONFIG.includedCredits, 300);
  });

  it('velocity alerting disabled by default', () => {
    assert.equal(DEFAULT_USER_CONFIG.alerts.velocityEnabled, false);
  });
});
