import * as assert from 'assert';
import {
  evaluateAlerts,
  velocityCreditsPerHour,
  SnapshotSample,
} from '../../src/domain/alerts';
import { DEFAULT_USER_CONFIG, UsageSnapshot, UserConfig } from '../../src/domain/types';

function snap(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    budget: { percentOfBudget: 0, usedCost: 0, usedCredits: 0 } as UsageSnapshot['budget'],
    today: { credits: 0, cost: 0, tokens: 0 },
    currentBranchCredits: 0,
    ...overrides,
  } as UsageSnapshot;
}

function cfg(overrides: Partial<UserConfig> = {}): UserConfig {
  return { ...DEFAULT_USER_CONFIG, ...overrides };
}

const NOW = 1_700_000_000_000; // fixed epoch for deterministic month/day keys
const EMPTY_FIRED = new Map<string, number>();
const NO_HISTORY: SnapshotSample[] = [];

describe('velocityCreditsPerHour()', () => {
  it('returns null with fewer than 2 samples', () => {
    assert.equal(velocityCreditsPerHour([]), null);
    assert.equal(velocityCreditsPerHour([{ ts: NOW, todayCredits: 10 }]), null);
  });

  it('returns null when elapsed time is zero', () => {
    assert.equal(
      velocityCreditsPerHour([
        { ts: NOW, todayCredits: 10 },
        { ts: NOW, todayCredits: 20 },
      ]),
      null,
    );
  });

  it('returns null when credits did not increase', () => {
    assert.equal(
      velocityCreditsPerHour([
        { ts: NOW, todayCredits: 20 },
        { ts: NOW + 3_600_000, todayCredits: 20 },
      ]),
      null,
    );
    assert.equal(
      velocityCreditsPerHour([
        { ts: NOW, todayCredits: 30 },
        { ts: NOW + 3_600_000, todayCredits: 20 },
      ]),
      null,
    );
  });

  it('computes correct rate over 1 hour', () => {
    const rate = velocityCreditsPerHour([
      { ts: NOW, todayCredits: 0 },
      { ts: NOW + 3_600_000, todayCredits: 60 },
    ]);
    assert.equal(rate, 60);
  });

  it('computes correct rate over 2 hours with intermediate samples', () => {
    const rate = velocityCreditsPerHour([
      { ts: NOW, todayCredits: 0 },
      { ts: NOW + 3_600_000, todayCredits: 30 },
      { ts: NOW + 7_200_000, todayCredits: 80 },
    ]);
    assert.equal(rate, 40); // 80 credits over 2 hours
  });
});

describe('evaluateAlerts() — budget', () => {
  it('fires at 100% when monthlyBudget is set', () => {
    const out = evaluateAlerts(
      snap({ budget: { percentOfBudget: 1.0 } as UsageSnapshot['budget'] }),
      NO_HISTORY,
      cfg({ monthlyBudget: 20 }),
      EMPTY_FIRED,
      NOW,
    );
    assert.equal(out.length, 1);
    assert.ok(out[0]!.message.includes('$20'));
    assert.ok(out[0]!.key.startsWith('budget-100-'));
  });

  it('fires at 80% (not yet 100%)', () => {
    const out = evaluateAlerts(
      snap({ budget: { percentOfBudget: 0.85 } as UsageSnapshot['budget'] }),
      NO_HISTORY,
      cfg({ monthlyBudget: 20 }),
      EMPTY_FIRED,
      NOW,
    );
    assert.equal(out.length, 1);
    assert.ok(out[0]!.key.startsWith('budget-80-'));
    assert.ok(out[0]!.message.includes('80%'));
  });

  it('does not fire below 80%', () => {
    const out = evaluateAlerts(
      snap({ budget: { percentOfBudget: 0.5 } as UsageSnapshot['budget'] }),
      NO_HISTORY,
      cfg({ monthlyBudget: 20 }),
      EMPTY_FIRED,
      NOW,
    );
    assert.equal(out.length, 0);
  });

  it('does not fire when monthlyBudget is 0', () => {
    const out = evaluateAlerts(
      snap({ budget: { percentOfBudget: 1.5 } as UsageSnapshot['budget'] }),
      NO_HISTORY,
      cfg({ monthlyBudget: 0 }),
      EMPTY_FIRED,
      NOW,
    );
    assert.equal(out.length, 0);
  });

  it('respects 4h cooldown on 100% alert', () => {
    const key = `budget-100-${new Date(NOW).getMonth()}`;
    const fired = new Map([[key, NOW - 1_000]]); // fired 1 second ago
    const out = evaluateAlerts(
      snap({ budget: { percentOfBudget: 1.0 } as UsageSnapshot['budget'] }),
      NO_HISTORY,
      cfg({ monthlyBudget: 20 }),
      fired,
      NOW,
    );
    assert.equal(out.length, 0);
  });

  it('respects 4h cooldown on 80% alert', () => {
    const key = `budget-80-${new Date(NOW).getMonth()}`;
    const fired = new Map([[key, NOW - 1_000]]);
    const out = evaluateAlerts(
      snap({ budget: { percentOfBudget: 0.85 } as UsageSnapshot['budget'] }),
      NO_HISTORY,
      cfg({ monthlyBudget: 20 }),
      fired,
      NOW,
    );
    assert.equal(out.length, 0);
  });

  it('fires again after cooldown expires', () => {
    const key = `budget-100-${new Date(NOW).getMonth()}`;
    const fired = new Map([[key, NOW - 5 * 60 * 60 * 1000]]); // 5h ago
    const out = evaluateAlerts(
      snap({ budget: { percentOfBudget: 1.0 } as UsageSnapshot['budget'] }),
      NO_HISTORY,
      cfg({ monthlyBudget: 20 }),
      fired,
      NOW,
    );
    assert.equal(out.length, 1);
  });
});

describe('evaluateAlerts() — daily credit threshold', () => {
  it('fires when today.credits >= threshold', () => {
    const out = evaluateAlerts(
      snap({ today: { credits: 50, cost: 0, tokens: 0 } }),
      NO_HISTORY,
      cfg({ dailyCreditAlert: 50 }),
      EMPTY_FIRED,
      NOW,
    );
    assert.equal(out.length, 1);
    assert.ok(out[0]!.message.includes('50'));
  });

  it('does not fire below threshold', () => {
    const out = evaluateAlerts(
      snap({ today: { credits: 49, cost: 0, tokens: 0 } }),
      NO_HISTORY,
      cfg({ dailyCreditAlert: 50 }),
      EMPTY_FIRED,
      NOW,
    );
    assert.equal(out.length, 0);
  });

  it('does not fire when dailyCreditAlert is 0', () => {
    const out = evaluateAlerts(
      snap({ today: { credits: 100, cost: 0, tokens: 0 } }),
      NO_HISTORY,
      cfg({ dailyCreditAlert: 0 }),
      EMPTY_FIRED,
      NOW,
    );
    assert.equal(out.length, 0);
  });

  it('respects 24h cooldown', () => {
    const key = `daily-${new Date(NOW).toDateString()}`;
    const fired = new Map([[key, NOW - 60_000]]);
    const out = evaluateAlerts(
      snap({ today: { credits: 100, cost: 0, tokens: 0 } }),
      NO_HISTORY,
      cfg({ dailyCreditAlert: 50 }),
      fired,
      NOW,
    );
    assert.equal(out.length, 0);
  });
});

describe('evaluateAlerts() — velocity', () => {
  const history: SnapshotSample[] = [
    { ts: NOW - 3_600_000, todayCredits: 0 },
    { ts: NOW, todayCredits: 60 },
  ];

  it('fires when rate >= threshold', () => {
    const out = evaluateAlerts(
      snap(),
      history,
      cfg({ alerts: { velocityEnabled: true, velocityCreditsPerHour: 50 } }),
      EMPTY_FIRED,
      NOW,
    );
    assert.equal(out.length, 1);
    assert.equal(out[0]!.key, 'velocity');
    assert.ok(out[0]!.message.includes('60'));
  });

  it('does not fire when rate is below threshold', () => {
    const slowHistory: SnapshotSample[] = [
      { ts: NOW - 3_600_000, todayCredits: 0 },
      { ts: NOW, todayCredits: 10 }, // 10 cr/h, below threshold of 50
    ];
    const out = evaluateAlerts(
      snap(),
      slowHistory,
      cfg({ alerts: { velocityEnabled: true, velocityCreditsPerHour: 50 } }),
      EMPTY_FIRED,
      NOW,
    );
    assert.equal(out.length, 0);
  });

  it('does not fire when velocityEnabled is false', () => {
    const out = evaluateAlerts(
      snap(),
      history,
      cfg({ alerts: { velocityEnabled: false, velocityCreditsPerHour: 50 } }),
      EMPTY_FIRED,
      NOW,
    );
    assert.equal(out.length, 0);
  });

  it('does not fire when velocityCreditsPerHour threshold is 0', () => {
    const out = evaluateAlerts(
      snap(),
      history,
      cfg({ alerts: { velocityEnabled: true, velocityCreditsPerHour: 0 } }),
      EMPTY_FIRED,
      NOW,
    );
    assert.equal(out.length, 0);
  });

  it('does not fire when history is too short', () => {
    const out = evaluateAlerts(
      snap(),
      [history[0]!],
      cfg({ alerts: { velocityEnabled: true, velocityCreditsPerHour: 50 } }),
      EMPTY_FIRED,
      NOW,
    );
    assert.equal(out.length, 0);
  });

  it('respects 1h cooldown', () => {
    const fired = new Map([['velocity', NOW - 1_000]]);
    const out = evaluateAlerts(
      snap(),
      history,
      cfg({ alerts: { velocityEnabled: true, velocityCreditsPerHour: 50 } }),
      fired,
      NOW,
    );
    assert.equal(out.length, 0);
  });
});

describe('evaluateAlerts() — branchBudgets', () => {
  it('fires when currentBranchCredits >= cap', () => {
    const out = evaluateAlerts(
      snap({ currentBranch: 'main', currentBranchCredits: 200 }),
      NO_HISTORY,
      cfg({ branchBudgets: { main: 200 } }),
      EMPTY_FIRED,
      NOW,
    );
    assert.equal(out.length, 1);
    assert.equal(out[0]!.key, 'branch:main');
    assert.ok(out[0]!.message.includes("'main'"));
    assert.ok(out[0]!.message.includes('200'));
  });

  it('does not fire below cap', () => {
    const out = evaluateAlerts(
      snap({ currentBranch: 'main', currentBranchCredits: 199 }),
      NO_HISTORY,
      cfg({ branchBudgets: { main: 200 } }),
      EMPTY_FIRED,
      NOW,
    );
    assert.equal(out.length, 0);
  });

  it('does not fire when config.branchBudgets is undefined', () => {
    const out = evaluateAlerts(
      snap({ currentBranch: 'main', currentBranchCredits: 500 }),
      NO_HISTORY,
      cfg(),
      EMPTY_FIRED,
      NOW,
    );
    assert.equal(out.length, 0);
  });

  it('does not fire when currentBranch is undefined', () => {
    const out = evaluateAlerts(
      snap({ currentBranchCredits: 500 }),
      NO_HISTORY,
      cfg({ branchBudgets: { main: 200 } }),
      EMPTY_FIRED,
      NOW,
    );
    assert.equal(out.length, 0);
  });

  it('does not fire when the branch has no cap entry', () => {
    const out = evaluateAlerts(
      snap({ currentBranch: 'feature/foo', currentBranchCredits: 500 }),
      NO_HISTORY,
      cfg({ branchBudgets: { main: 200 } }),
      EMPTY_FIRED,
      NOW,
    );
    assert.equal(out.length, 0);
  });

  it('respects 4h cooldown', () => {
    const fired = new Map([['branch:main', NOW - 1_000]]);
    const out = evaluateAlerts(
      snap({ currentBranch: 'main', currentBranchCredits: 200 }),
      NO_HISTORY,
      cfg({ branchBudgets: { main: 200 } }),
      fired,
      NOW,
    );
    assert.equal(out.length, 0);
  });

  it('fires again after 4h cooldown expires', () => {
    const fired = new Map([['branch:main', NOW - 5 * 60 * 60 * 1000]]);
    const out = evaluateAlerts(
      snap({ currentBranch: 'main', currentBranchCredits: 200 }),
      NO_HISTORY,
      cfg({ branchBudgets: { main: 200 } }),
      fired,
      NOW,
    );
    assert.equal(out.length, 1);
  });
});
