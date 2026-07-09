import { strict as assert } from 'assert';
import { UsageService } from '../../../src/extension-backend/app/UsageService';
import type { IEventSnapshotReader, SnapshotSourceData } from '../../../src/extension-backend/store/EventReader';
import type { IngestService } from '../../../src/extension-backend/ingest/IngestService';
import type { UserConfigStore } from '../../../src/extension-backend/app/UserConfigStore';
import type { PricingService } from '../../../src/extension-backend/pricing/PricingService';
import type { CurrencyService } from '../../../src/extension-backend/pricing/CurrencyService';
import type { UsageSnapshot } from '../../../src/extension-backend/domain/types';
import { startOf } from '../../../src/extension-backend/util/time';

const NOW = Date.now();
const TODAY = startOf(NOW, 'day');

function fixtureData(): SnapshotSourceData {
  return {
    totals: {
      all:   { credits: 30, cost: 1.2, tokens: 9000, eventCount: 12 },
      mtd:   { credits: 20, cost: 0.8, tokens: 6000, eventCount: 8 },
      today: { credits: 5,  cost: 0.2, tokens: 1500, eventCount: 2 },
    },
    estimatedEventCount: 9,
    daily: [
      { dayStart: TODAY - 86_400_000, credits: 25, cost: 1.0, tokens: 7500, eventCount: 10, catInput: 0.3, catOutput: 0.4, catCacheRead: 0.1, catCacheCreation: 0.1, catThinking: 0.05, catTool: 0.05 },
      { dayStart: TODAY,              credits: 5,  cost: 0.2, tokens: 1500, eventCount: 2, catInput: 0, catOutput: 0, catCacheRead: 0, catCacheCreation: 0, catThinking: 0, catTool: 0 },
    ],
    models: [
      { modelId: 'claude-sonnet-4-5', credits: 18, cost: 0.72, tokens: 6000 },
      { modelId: 'gpt-4o',            credits: 12, cost: 0.48, tokens: 3000 },
    ],
    languages: [{ language: 'typescript', credits: 12, cost: 0.5, tokens: 4000 }],
    repos: [{ repo: 'mallard', credits: 30, cost: 1.2, tokens: 9000, heuristicShare: 0 }],
    hourly: [{ hourLocal: 14, credits: 22 }, { hourLocal: 9, credits: 8 }],
    categories: [{ category: 'input', cost: 0.5 }, { category: 'output', cost: 0.7 }],
    sankey: [{ model: 'claude-sonnet-4-5', surface: 'agent', count: 8, credits: 18 }],
    dims: {
      models: ['claude-sonnet-4-5', 'gpt-4o'],
      surfaces: ['agent', 'chat'],
      sources: ['claude-code', 'local'],
      repos: ['mallard'],
    },
    weekday: [0, 5, 10, 5, 5, 5, 0],
  };
}

function makeService(data: SnapshotSourceData) {
  const reader: IEventSnapshotReader = {
    readSnapshotCache: async () => data,
    readFilteredSnapshot: async () => data,
    creditsByBranch: async () => 0,
  };
  const pricing = {
    pricePerCredit: 0.04,
    currentManifest: undefined,
    tokenPrices: undefined,
  } as unknown as PricingService;
  const ingest = {
    getStatus: () => ({ kind: 'ok' as const }),
    getLogPaths: () => [],
    getSearchedDirs: () => [],
    getKnownDirs: () => [],
    start: async () => {},
    dispose: () => {},
  } as unknown as IngestService;
  const userConfig = {
    get: () => ({
      monthlyBudget: 0,
      includedCredits: 300,
      dailyCreditAlert: 0,
      alerts: { velocityEnabled: false, velocityCreditsPerHour: 0 },
      version: 1 as const,
    }),
    onDidChange: () => ({ dispose() {} }),
  } as unknown as UserConfigStore;
  const currency = { currentRates: () => ({}) } as unknown as CurrencyService;
  const svc = new UsageService(
    reader, pricing, ingest, userConfig, currency, undefined,
    { showWarningMessage: async () => undefined } as never,
  );
  return { svc };
}

/** Strip the fields that legitimately differ between the two read paths. */
function comparable(s: UsageSnapshot): Partial<UsageSnapshot> {
  const { generatedAt: _g, filter: _f, isIncremental: _i, ...rest } = s;
  return rest;
}

describe('UsageService — snapshot assembly (merged compute path)', () => {
  it('cache path and filtered path assemble identical snapshots from the same data', async () => {
    const { svc } = makeService(fixtureData());

    // Freeze the clock: compute() stamps Date.now() into forecast.asOf etc.,
    // and the two runs would otherwise differ by a few milliseconds.
    const realNow = Date.now;
    Date.now = () => NOW;
    try {
      await svc.setFilter({}); // empty filter → readSnapshotCache
      const fromCache = svc.current!;

      await svc.setFilter({ models: ['claude-sonnet-4-5'] }); // → readFilteredSnapshot
      const fromFiltered = svc.current!;

      assert.deepEqual(comparable(fromFiltered), comparable(fromCache));
    } finally {
      Date.now = realNow;
      svc.dispose();
    }
  });

  it('assembles totals, dimensions, and rankings from the data bundle', async () => {
    const { svc } = makeService(fixtureData());
    await svc.setFilter({});
    const s = svc.current!;

    assert.equal(s.today.credits, 5);
    assert.equal(s.budget.usedCredits, 20); // mtd
    assert.deepEqual(s.allModels, ['claude-sonnet-4-5', 'gpt-4o']);
    assert.deepEqual(s.allSources, ['claude-code', 'local']);
    assert.equal(s.topModels[0]!.key, 'claude-sonnet-4-5');
    assert.equal(s.byRepo[0]!.key, 'mallard');
    assert.equal(s.byLanguage[0]!.key, 'typescript');
    assert.equal(s.byLanguage[0]!.credits, 12);
    assert.deepEqual(s.sankeyLinks, [{ source: 'claude-sonnet-4-5', target: 'agent', value: 18 }]);
    assert.equal(s.totalEventCount, 12);
    assert.equal(s.estimatedEventCount, 9);
    assert.equal(s.source, 'mixed'); // two sources present (claude-code + local)
    assert.equal(s.chartData.hourlyTimeline.peakHour, 14);
    svc.dispose();
  });

  it('reports peakHour null (not midnight) when there is no hourly activity', async () => {
    const data = fixtureData();
    data.hourly = [];
    const { svc } = makeService(data);
    await svc.setFilter({});
    assert.equal(svc.current!.chartData.hourlyTimeline.peakHour, null);
    svc.dispose();
  });

  it('source reflects the single event source when only one is present', async () => {
    const data = fixtureData();
    data.dims.sources = ['claude-code'];
    const { svc } = makeService(data);
    await svc.setFilter({});
    assert.equal(svc.current!.source, 'claude-code');
    svc.dispose();
  });

  it("source is 'mixed' when more than one event source is present", async () => {
    const data = fixtureData();
    data.dims.sources = ['local', 'claude-code'];
    const { svc } = makeService(data);
    await svc.setFilter({});
    assert.equal(svc.current!.source, 'mixed');
    svc.dispose();
  });
});
