import * as assert from 'assert';
import { evaluateAlerts, velocityCreditsPerHour, SnapshotSample } from '../../src/domain/alerts';
import { DEFAULT_USER_CONFIG, UsageSnapshot, UserConfig } from '../../src/domain/types';

const HOUR = 60 * 60 * 1000;

function snap(percentOfBudget: number, todayCredits: number): UsageSnapshot {
  return {
    budget: { percentOfBudget } as UsageSnapshot['budget'],
    today: { credits: todayCredits, cost: 0, tokens: 0 },
  } as UsageSnapshot;
}

function cfg(patch: Partial<UserConfig>): UserConfig {
  return { ...DEFAULT_USER_CONFIG, ...patch };
}

describe('evaluateAlerts', () => {
  const now = Date.now();

  it('fires nothing when no thresholds are configured', () => {
    const out = evaluateAlerts(snap(2, 1000), [], DEFAULT_USER_CONFIG, new Map(), now);
    assert.equal(out.length, 0);
  });

  it('fires the 80% budget alert and respects cooldown', () => {
    const config = cfg({ monthlyBudget: 100 });
    const first = evaluateAlerts(snap(0.85, 0), [], config, new Map(), now);
    assert.equal(first.length, 1);
    assert.ok(first[0]!.key.startsWith('budget-80'));

    const fired = new Map([[first[0]!.key, now]]);
    const again = evaluateAlerts(snap(0.85, 0), [], config, fired, now + HOUR);
    assert.equal(again.length, 0, 'within cooldown');
  });

  it('prefers the 100% alert over 80% when over budget', () => {
    const out = evaluateAlerts(snap(1.2, 0), [], cfg({ monthlyBudget: 100 }), new Map(), now);
    assert.equal(out.length, 1);
    assert.ok(out[0]!.key.startsWith('budget-100'));
  });

  it('fires the daily credit alert when exceeded', () => {
    const out = evaluateAlerts(snap(0, 60), [], cfg({ dailyCreditAlert: 50 }), new Map(), now);
    assert.equal(out.length, 1);
    assert.ok(out[0]!.key.startsWith('daily-'));
  });

  it('fires a velocity alert when the rate crosses the threshold', () => {
    const history: SnapshotSample[] = [
      { ts: now - HOUR, todayCredits: 0 },
      { ts: now, todayCredits: 120 },
    ];
    const config = cfg({ alerts: { velocityEnabled: true, velocityCreditsPerHour: 100 } });
    const out = evaluateAlerts(snap(0, 120), history, config, new Map(), now);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.key, 'velocity');
  });

  it('does not fire velocity when disabled', () => {
    const history: SnapshotSample[] = [
      { ts: now - HOUR, todayCredits: 0 },
      { ts: now, todayCredits: 500 },
    ];
    const config = cfg({ alerts: { velocityEnabled: false, velocityCreditsPerHour: 100 } });
    assert.equal(evaluateAlerts(snap(0, 500), history, config, new Map(), now).length, 0);
  });
});

describe('velocityCreditsPerHour', () => {
  it('returns null with insufficient history', () => {
    assert.equal(velocityCreditsPerHour([]), null);
    assert.equal(velocityCreditsPerHour([{ ts: 0, todayCredits: 5 }]), null);
  });

  it('computes a positive rate', () => {
    const rate = velocityCreditsPerHour([
      { ts: 0, todayCredits: 0 },
      { ts: 2 * HOUR, todayCredits: 100 },
    ]);
    assert.equal(rate, 50);
  });
});
