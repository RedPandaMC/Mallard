import { strict as assert } from 'assert';
import { buildRuleContext } from '../../src/domain/expr/context';
import type { UsageSnapshot } from '../../src/domain/types';

function minimalSnapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    generatedAt: Date.now(),
    today: { credits: 10, cost: 0.4, tokens: 500 },
    budget: {
      monthly: 20,
      includedCredits: 300,
      usedCredits: 50,
      usedCost: 2,
      percentOfBudget: 0.1,
      percentOfIncluded: 0.16,
      projectedOverage: null,
      pace: 'on-track',
    },
    forecast: {
      granularity: 'month',
      projectedCredits: 100,
      projectedCost: 4,
      low: 80,
      high: 120,
      basis: 'linear',
      asOf: Date.now(),
    },
    topModels: [],
    allModels: [],
    allSurfaces: [],
    allRepos: [],
    byRepo: [],
    sankeyLinks: [],
    chartData: { barChart: { labels: [], datasets: [] }, categoryBreakdown: { categories: [], costs: [], tokens: [] } },
    authStatus: 'signed-out',
    status: { kind: 'ok' },
    ...overrides,
  } as unknown as UsageSnapshot;
}

describe('buildRuleContext — null snapshot', () => {
  it('returns zeroes for numeric fields', () => {
    const ctx = buildRuleContext({ snapshot: null });
    assert.deepEqual(ctx['today'], { credits: 0, cost: 0, tokens: 0 });
    assert.equal((ctx['budget'] as Record<string, unknown>)['usedCredits'], 0);
    assert.equal((ctx['velocity'] as Record<string, unknown>)['creditsPerHour'], 0);
  });

  it('signedIn defaults to false', () => {
    const ctx = buildRuleContext({ snapshot: null });
    assert.equal(ctx['signedIn'], false);
  });

  it('billing is null when no githubBilling', () => {
    const ctx = buildRuleContext({ snapshot: minimalSnapshot() });
    assert.equal(ctx['billing'], null);
  });
});

describe('buildRuleContext — snapshot fields', () => {
  it('today populates from snapshot', () => {
    const ctx = buildRuleContext({ snapshot: minimalSnapshot() });
    assert.deepEqual(ctx['today'], { credits: 10, cost: 0.4, tokens: 500 });
  });

  it('month fields come from budget.usedCredits/usedCost', () => {
    const ctx = buildRuleContext({ snapshot: minimalSnapshot() });
    const month = ctx['month'] as Record<string, unknown>;
    assert.equal(month['credits'], 50);
    assert.equal(month['cost'], 2);
  });

  it('budget object is populated', () => {
    const ctx = buildRuleContext({ snapshot: minimalSnapshot() });
    const b = ctx['budget'] as Record<string, unknown>;
    assert.equal(b['monthly'], 20);
    assert.equal(b['percentOfBudget'], 0.1);
    assert.equal(b['pace'], 'on-track');
  });

  it('forecast fields are set', () => {
    const ctx = buildRuleContext({ snapshot: minimalSnapshot() });
    const f = ctx['forecast'] as Record<string, unknown>;
    assert.equal(f['projectedCredits'], 100);
    assert.equal(f['basis'], 'linear');
  });

  it('model map populated from topModels', () => {
    const snap = minimalSnapshot({
      topModels: [{ key: 'gpt-4o', credits: 30, cost: 1.2, tokens: 0 }] as unknown as UsageSnapshot['topModels'],
      allModels: ['gpt-4o'],
    });
    const ctx = buildRuleContext({ snapshot: snap });
    const model = ctx['model'] as Record<string, unknown>;
    assert.ok('gpt-4o' in model);
    assert.equal((model['gpt-4o'] as Record<string, number>)['credits'], 30);
  });

  it('repo map populated from byRepo', () => {
    const snap = minimalSnapshot({
      byRepo: [{ key: 'org/repo', credits: 15, cost: 0.6, tokens: 0 }] as unknown as UsageSnapshot['byRepo'],
      allRepos: ['org/repo'],
    });
    const ctx = buildRuleContext({ snapshot: snap });
    const repo = ctx['repo'] as Record<string, unknown>;
    assert.ok('org/repo' in repo);
  });

  it('vars are passed through from input', () => {
    const ctx = buildRuleContext({ snapshot: null, vars: { threshold: 100 } });
    assert.equal((ctx['vars'] as Record<string, unknown>)['threshold'], 100);
  });

  it('branchBudgets passed through', () => {
    const ctx = buildRuleContext({ snapshot: null, branchBudgets: { main: 50 } });
    assert.equal((ctx['branchBudgets'] as Record<string, unknown>)['main'], 50);
  });
});

describe('buildRuleContext — now fields', () => {
  it('now fields reflect the provided timestamp', () => {
    const ts = new Date(2026, 0, 5, 14, 30).getTime(); // Mon Jan 5 2026 14:30
    const ctx = buildRuleContext({ snapshot: null, now: ts });
    const now = ctx['now'] as Record<string, unknown>;
    assert.equal(now['ts'], ts);
    assert.equal(now['hour'], 14);
    assert.equal(now['minute'], 30);
    assert.ok(typeof now['iso'] === 'string');
    assert.ok(!isNaN(Date.parse(now['iso'] as string)));
  });
});

describe('buildRuleContext — velocity', () => {
  it('velocity > 0 from two history samples with positive delta', () => {
    const baseTs = Date.now() - 60_000;
    const history = [
      { ts: baseTs, todayCredits: 10 },
      { ts: baseTs + 60_000, todayCredits: 11 },
    ];
    const ctx = buildRuleContext({ snapshot: null, history });
    const vel = ctx['velocity'] as Record<string, unknown>;
    assert.ok((vel['creditsPerHour'] as number) > 0);
    assert.ok((vel['windowMinutes'] as number) > 0);
  });

  it('velocity is 0 with fewer than 2 history samples', () => {
    const ctx = buildRuleContext({ snapshot: null, history: [{ ts: Date.now(), todayCredits: 10 }] });
    const vel = ctx['velocity'] as Record<string, unknown>;
    assert.equal(vel['creditsPerHour'], 0);
  });

  it('velocity is 0 when delta is zero or negative', () => {
    const baseTs = Date.now() - 60_000;
    const history = [
      { ts: baseTs, todayCredits: 20 },
      { ts: baseTs + 60_000, todayCredits: 15 }, // decreased
    ];
    const ctx = buildRuleContext({ snapshot: null, history });
    const vel = ctx['velocity'] as Record<string, unknown>;
    assert.equal(vel['creditsPerHour'], 0);
  });
});

describe('buildRuleContext — billing', () => {
  it('billing is populated when githubBilling is present', () => {
    const snap = minimalSnapshot({} as Partial<UsageSnapshot>);
    (snap as unknown as Record<string, unknown>)['githubBilling'] = {
      totalNetAmount: 5,
      items: [{ grossAmount: 6 }],
      quota: { used: 100, entitlement: 500, unlimited: false },
    };
    const ctx = buildRuleContext({ snapshot: snap });
    const billing = ctx['billing'] as Record<string, unknown>;
    assert.ok(billing !== null);
    assert.equal(billing['netAmount'], 5);
    assert.ok(Math.abs((billing['quotaPercentRemaining'] as number) - 0.8) < 0.001);
    assert.equal(billing['unlimited'], false);
  });
});
