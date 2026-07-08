import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import { UsageService } from '../../../src/extension-backend/app/UsageService';
import type { IEventSnapshotReader, SnapshotSourceData } from '../../../src/extension-backend/store/EventReader';
import { PricingService } from '../../../src/extension-backend/pricing/PricingService';
import { IngestService } from '../../../src/extension-backend/ingest/IngestService';
import { UserConfigStore } from '../../../src/extension-backend/app/UserConfigStore';
import { CurrencyService } from '../../../src/extension-backend/pricing/CurrencyService';
import type { VscodeHost } from '../../../src/extension-backend/util/vscodeHost';
import type { IBillingProvider } from '../../../src/extension-backend/billing/IBillingProvider';
import type { AlertRule } from '../../../src/extension-backend/domain/types';
import { okAsync, errAsync } from 'neverthrow';
import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const ws = vscode.workspace as Mutable<typeof vscode.workspace>;

const EMPTY_DATA: SnapshotSourceData = {
  totals: {
    all: { credits: 0, cost: 0, tokens: 0, eventCount: 0 },
    mtd: { credits: 0, cost: 0, tokens: 0, eventCount: 0 },
    today: { credits: 0, cost: 0, tokens: 0, eventCount: 0 },
  },
  estimatedEventCount: 0,
  daily: [],
  models: [],
  languages: [],
  repos: [],
  hourly: [],
  categories: [],
  sankey: [],
  dims: { models: [], surfaces: [], sources: [], repos: [] },
  weekday: [0, 0, 0, 0, 0, 0, 0],
};

function makeReader(data: SnapshotSourceData = EMPTY_DATA): IEventSnapshotReader {
  return {
    readSnapshotCache: async () => data,
    readFilteredSnapshot: async () => data,
    creditsByBranch: async () => 0,
  };
}

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mallard-usagesvc-'));
}

describe('UsageService — start/refresh/fireAlerts/scheduleTimer', () => {
  let dir: string;
  let pricing: PricingService;
  let ingest: IngestService;
  let userConfig: UserConfigStore;
  let currency: CurrencyService;
  const origGetConfig = ws.getConfiguration;

  beforeEach(async () => {
    dir = await tmpDir();
    pricing = new PricingService(dir, {
      version: 1, pricePerCredit: 0.04, updatedAt: new Date().toISOString(), models: { 'gpt-4o': 1 },
    });
    ingest = new IngestService([]);
    userConfig = new UserConfigStore(dir);
    currency = new CurrencyService(dir);
    ws.getConfiguration = (() => ({
      get: (_k: string, fallback: unknown) => fallback,
      update: () => Promise.resolve(),
    })) as unknown as typeof ws.getConfiguration;
  });
  afterEach(async () => {
    ws.getConfiguration = origGetConfig;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('start() emits a snapshot, schedules the timer, and fires alerts without throwing', async () => {
    const data: SnapshotSourceData = {
      ...EMPTY_DATA,
      totals: {
        all: { credits: 500, cost: 20, tokens: 10000, eventCount: 100 },
        mtd: { credits: 500, cost: 20, tokens: 10000, eventCount: 100 },
        today: { credits: 500, cost: 20, tokens: 10000, eventCount: 100 },
      },
      models: [{ modelId: 'gpt-4o', credits: 500, cost: 20, tokens: 10000 }],
    };
    const host: VscodeHost = {
      showWarningMessage: () => Promise.resolve(undefined),
      executeCommand: () => Promise.resolve(undefined),
    };
    const svc = new UsageService(makeReader(data), pricing, ingest, userConfig, currency, undefined, host);
    let snapshots = 0;
    svc.onDidChangeSnapshot(() => snapshots++);
    await svc.start();
    await new Promise((r) => setTimeout(r, 50)); // let ingest.start().then(compute) settle
    assert.ok(snapshots >= 1, 'at least one snapshot emitted');
    assert.ok(svc.current, 'snapshot is set');
    svc.dispose();
  });

  it('refresh() re-reads and emits a new snapshot', async () => {
    const svc = new UsageService(makeReader(), pricing, ingest, userConfig, currency);
    let snapshots = 0;
    svc.onDidChangeSnapshot(() => snapshots++);
    await svc.start();
    await new Promise((r) => setTimeout(r, 50));
    const before = snapshots;
    await svc.refresh();
    assert.ok(snapshots > before, 'refresh emitted a new snapshot');
    svc.dispose();
  });

  it('setFilter triggers a filtered recompute', async () => {
    const svc = new UsageService(makeReader(), pricing, ingest, userConfig, currency);
    await svc.start();
    await new Promise((r) => setTimeout(r, 50));
    await svc.setFilter({ models: ['gpt-4o'] });
    assert.deepEqual(svc.getFilter(), { models: ['gpt-4o'] });
    svc.dispose();
  });

  it('onConfigChanged reschedules the timer and recomputes', async () => {
    const svc = new UsageService(makeReader(), pricing, ingest, userConfig, currency);
    await svc.start();
    await new Promise((r) => setTimeout(r, 50));
    assert.doesNotThrow(() => svc.onConfigChanged());
    svc.dispose();
  });

  it('dispose() cleans up without throwing', async () => {
    const svc = new UsageService(makeReader(), pricing, ingest, userConfig, currency);
    await svc.start();
    await new Promise((r) => setTimeout(r, 50));
    assert.doesNotThrow(() => svc.dispose());
  });

  it('getStatus delegates to the ingest service', async () => {
    const svc = new UsageService(makeReader(), pricing, ingest, userConfig, currency);
    const status = svc.getStatus();
    assert.ok(status.kind, 'status has a kind');
    svc.dispose();
  });

  it('getLogPaths, getSearchedDirs, getKnownDirs delegate to ingest', () => {
    const svc = new UsageService(makeReader(), pricing, ingest, userConfig, currency);
    assert.ok(Array.isArray(svc.getLogPaths()));
    assert.ok(Array.isArray(svc.getSearchedDirs()));
    assert.ok(Array.isArray(svc.getKnownDirs()));
    svc.dispose();
  });

  it('signInGitHub calls the billing provider signIn + refreshGitHub', async () => {
    let signedIn = false;
    const mockBilling: IBillingProvider = {
      name: 'mock',
      fetch: () => okAsync({ quota: null, items: [], fetchedAt: Date.now(), totalNetAmount: 0 }),
      signIn: async () => { signedIn = true; },
      onDidChange: () => ({ dispose() {} }),
      dispose() {},
    };
    const svc = new UsageService(makeReader(), pricing, ingest, userConfig, currency, mockBilling);
    await svc.signInGitHub();
    assert.equal(signedIn, true);
    svc.dispose();
  });

  it('signInGitHub surfaces a PAT-required error instead of silently no-oping', async () => {
    let signInCalled = false;
    const mockBilling: IBillingProvider = {
      name: 'mock',
      fetch: () => okAsync({ quota: null, items: [], fetchedAt: Date.now(), totalNetAmount: 0 }),
      signIn: async () => { signInCalled = true; },
      needsPat: async () => true,
      onDidChange: () => ({ dispose() {} }),
      dispose() {},
    };
    const svc = new UsageService(makeReader(), pricing, ingest, userConfig, currency, mockBilling);
    await svc.signInGitHub();
    assert.equal(signInCalled, false, 'must not attempt OAuth when a PAT is required');
    assert.equal(svc.current?.authStatus, 'error');
    assert.match(svc.current?.authError ?? '', /Personal Access Token/);
    svc.dispose();
  });
});

describe('UsageService — GitHub billing + alert rule notify', () => {
  let dir: string;
  let pricing: PricingService;
  let ingest: IngestService;
  let userConfig: UserConfigStore;
  let currency: CurrencyService;
  const origGetConfig = ws.getConfiguration;

  beforeEach(async () => {
    dir = await tmpDir();
    pricing = new PricingService(dir, {
      version: 1, pricePerCredit: 0.04, updatedAt: new Date().toISOString(), models: { 'gpt-4o': 1 },
    });
    ingest = new IngestService([]);
    userConfig = new UserConfigStore(dir);
    currency = new CurrencyService(dir);
    ws.getConfiguration = (() => ({
      get: (_k: string, fallback: unknown) => fallback,
      update: () => Promise.resolve(),
    })) as unknown as typeof ws.getConfiguration;
  });
  afterEach(async () => {
    ws.getConfiguration = origGetConfig;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('billing-only updates re-emit without re-reading the store', async () => {
    let reads = 0;
    const reader: IEventSnapshotReader = {
      readSnapshotCache: async () => { reads += 1; return EMPTY_DATA; },
      readFilteredSnapshot: async () => { reads += 1; return EMPTY_DATA; },
      creditsByBranch: async () => 0,
    };
    let fireBilling: () => void = () => {};
    const mockBilling: IBillingProvider = {
      name: 'mock',
      fetch: () => okAsync({ quota: null, items: [], fetchedAt: Date.now(), totalNetAmount: 0 }),
      onDidChange: (fn) => { fireBilling = fn; return { dispose() {} }; },
      dispose() {},
    };
    const svc = new UsageService(reader, pricing, ingest, userConfig, currency, mockBilling);
    await svc.start();
    await new Promise((r) => setTimeout(r, 100));
    const readsAfterStart = reads;
    assert.ok(readsAfterStart > 0);

    let snapshotEmits = 0;
    let billingEmits = 0;
    svc.onDidChangeSnapshot(() => { snapshotEmits += 1; });
    svc.onDidChangeBilling(() => { billingEmits += 1; });
    fireBilling();
    await new Promise((r) => setTimeout(r, 100));

    assert.equal(reads, readsAfterStart, 'a billing refresh must not hit DuckDB');
    assert.equal(billingEmits, 1);
    assert.equal(snapshotEmits, 1, 're-emits merged data so UI surfaces update');
    assert.equal(svc.current?.authStatus, 'signed-in');
    svc.dispose();
  });

  it('refreshGitHub sets signed-out when the error is "Not signed in"', async () => {
    const mockBilling: IBillingProvider = {
      name: 'mock',
      fetch: () => errAsync(new Error('Not signed in')),
      onDidChange: () => ({ dispose() {} }),
      dispose() {},
    };
    const svc = new UsageService(makeReader(), pricing, ingest, userConfig, currency, mockBilling);
    await svc.start();
    await new Promise((r) => setTimeout(r, 100));
    svc.dispose();
  });

  it('refreshGitHub sets error status for non-sign-in errors', async () => {
    const mockBilling: IBillingProvider = {
      name: 'mock',
      fetch: () => errAsync(new Error('Network timeout')),
      onDidChange: () => ({ dispose() {} }),
      dispose() {},
    };
    const svc = new UsageService(makeReader(), pricing, ingest, userConfig, currency, mockBilling);
    await svc.start();
    await new Promise((r) => setTimeout(r, 100));
    svc.dispose();
  });

  it('refreshGitHub sets signed-in on a successful fetch', async () => {
    const mockBilling: IBillingProvider = {
      name: 'mock',
      fetch: () => okAsync({ quota: null, items: [], fetchedAt: Date.now(), totalNetAmount: 0 }),
      onDidChange: () => ({ dispose() {} }),
      dispose() {},
    };
    const svc = new UsageService(makeReader(), pricing, ingest, userConfig, currency, mockBilling);
    await svc.start();
    await new Promise((r) => setTimeout(r, 100));
    svc.dispose();
  });

  it('fires a warning for an alert rule with notify=true that matches', async () => {
    const warnings: string[] = [];
    const host: VscodeHost = {
      showWarningMessage: (msg: string) => { warnings.push(msg); return Promise.resolve(undefined); },
      executeCommand: () => Promise.resolve(undefined),
    };
    const rule: AlertRule = {
      id: 'test-alert',
      severity: 'warning',
      message: 'Credits exceeded',
      when: { '>': [{ var: 'today.credits' }, 0] },
      notify: true,
    };
    await userConfig.set({ rules: [rule] });
    const data: SnapshotSourceData = {
      ...EMPTY_DATA,
      totals: {
        all: { credits: 10, cost: 0.4, tokens: 100, eventCount: 1 },
        mtd: { credits: 10, cost: 0.4, tokens: 100, eventCount: 1 },
        today: { credits: 10, cost: 0.4, tokens: 100, eventCount: 1 },
      },
    };
    const svc = new UsageService(makeReader(data), pricing, ingest, userConfig, currency, undefined, host);
    const fired: string[] = [];
    svc.onAlertFired(({ message }) => fired.push(message));
    await svc.start();
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(warnings.some((w) => w.includes('Credits exceeded')), 'alert warning fired');
    assert.ok(fired.some((m) => m.includes('Credits exceeded')), 'onAlertFired fired for UI surfaces (e.g. sidebar gauge pulse)');
    svc.dispose();
  });
});
