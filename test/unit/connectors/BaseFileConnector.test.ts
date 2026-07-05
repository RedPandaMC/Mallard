import { strict as assert } from 'assert';
import { BaseFileConnector } from '../../../src/extension-backend/ingest/BaseFileConnector';
import type { IFsWatcher } from '../../../src/extension-backend/ingest/IFsWatcher';
import type { ParseContext } from '../../../src/extension-backend/ingest/otelParse';
import type { PricingService } from '../../../src/extension-backend/pricing/PricingService';
import type { IMetaStore as MetaStore } from '../../../src/extension-backend/store/MetaStore';
import type { DuckDBFileReader } from '../../../src/extension-backend/store/DuckDBFileReader';
import type { UsageEvent } from '../../../src/extension-backend/domain/types';

// ── Minimal concrete subclass for testing ──────────────────────────────────────

type DiscoverResult =
  | { globs: string[]; allowedRoots: string[]; searchedDirs: string[] }
  | { kind: 'sqlite'; dbPath: string; query: string; allowedRoots: string[]; searchedDirs: string[] };

class TestConnector extends BaseFileConnector {
  readonly id = 'test';
  readonly displayName = 'Test Connector';
  readonly capabilities = {
    tokenFields: [] as const,
    costCategories: [] as const,
    supportsRepoAttribution: false,
    sources: ['ndjson'] as const,
  };
  private _discoverResult: DiscoverResult = { globs: [], allowedRoots: [], searchedDirs: [] };

  setDiscoverResult(r: DiscoverResult): void { this._discoverResult = r; }

  protected async discover(): Promise<DiscoverResult> {
    return this._discoverResult;
  }

  mapRow(_row: Record<string, unknown>, _ctx: ParseContext): UsageEvent | null {
    return null;
  }
}

const FIXED_EVENT_TS = 1_700_000_000_000;

function makeStubs() {
  const pricing = { pricePerCredit: 0.04, currentManifest: undefined } as unknown as PricingService;
  const state = { watermark: null as string | null };
  const meta: MetaStore = {
    get: async () => state.watermark,
    set: async (_k, v) => { state.watermark = v; },
  };
  const ingestResults: number[] = [];
  const shiftResult = () => {
    const n = ingestResults.shift() ?? 0;
    return { inserted: n, maxEventTs: n > 0 ? FIXED_EVENT_TS : null };
  };
  const fileReader = {
    ingestGlob: async () => shiftResult(),
    ingestSqlite: async () => shiftResult(),
    hasField: async () => false,
  } as unknown as DuckDBFileReader;
  return { pricing, meta, fileReader, ingestResults, state };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('BaseFileConnector — lifecycle', () => {
  it('starts with status "idle"', () => {
    const { pricing, meta, fileReader } = makeStubs();
    const c = new TestConnector(pricing, meta, fileReader);
    assert.equal(c.getStatus(), 'idle');
  });

  it('start() sets status to "empty" when discover returns no globs', async () => {
    const { pricing, meta, fileReader } = makeStubs();
    const c = new TestConnector(pricing, meta, fileReader);
    await c.start();
    assert.equal(c.getStatus(), 'empty');
    assert.deepStrictEqual(c.getLogPaths(), []);
    assert.deepStrictEqual(c.getSearchedDirs(), []);
  });

  it('start() runs ingest and sets status to "ok" when events are inserted', async () => {
    const { pricing, meta, fileReader, ingestResults } = makeStubs();
    ingestResults.push(3); // fileReader.ingestGlob returns 3
    const c = new TestConnector(pricing, meta, fileReader);
    c.setDiscoverResult({ globs: ['/tmp/test/*.jsonl'], allowedRoots: ['/tmp/test'], searchedDirs: ['/tmp/test'] });
    await c.start();
    assert.equal(c.getStatus(), 'ok');
  });

  it('start() sets status to "empty" when ingest returns 0', async () => {
    const { pricing, meta, fileReader } = makeStubs();
    const c = new TestConnector(pricing, meta, fileReader);
    c.setDiscoverResult({ globs: ['/tmp/test/*.jsonl'], allowedRoots: ['/tmp/test'], searchedDirs: ['/tmp/test'] });
    // ingestResults is empty so ingestGlob returns 0
    await c.start();
    assert.equal(c.getStatus(), 'empty');
  });

  it('start() dispatches to ingestSqlite for a sqlite target', async () => {
    const { pricing, meta, fileReader, ingestResults } = makeStubs();
    ingestResults.push(2);
    const c = new TestConnector(pricing, meta, fileReader);
    c.setDiscoverResult({ kind: 'sqlite', dbPath: '/db/spans.sqlite', query: 'SELECT 1', allowedRoots: ['/db'], searchedDirs: ['/db'] });
    await c.start();
    assert.equal(c.getStatus(), 'ok');
  });

  it('start() sets status "empty" for a sqlite target with no dbPath', async () => {
    const { pricing, meta, fileReader } = makeStubs();
    const c = new TestConnector(pricing, meta, fileReader);
    c.setDiscoverResult({ kind: 'sqlite', dbPath: '', query: 'SELECT 1', allowedRoots: [], searchedDirs: [] });
    await c.start();
    assert.equal(c.getStatus(), 'empty');
  });

  it('start() sets status to "error" when ingestGlob throws', async () => {
    const { pricing, meta, fileReader } = makeStubs();
    const throwingReader = {
      ...fileReader,
      ingestGlob: async () => { throw new Error('DuckDB unavailable'); },
      hasField: async () => false,
    } as unknown as DuckDBFileReader;
    const c = new TestConnector(pricing, meta, throwingReader);
    c.setDiscoverResult({ globs: ['/tmp/*.jsonl'], allowedRoots: ['/tmp'], searchedDirs: ['/tmp'] });
    await c.start();
    assert.equal(c.getStatus(), 'error');
  });

  it('dispose() does not throw when no watchers exist', () => {
    const { pricing, meta, fileReader } = makeStubs();
    const c = new TestConnector(pricing, meta, fileReader);
    assert.doesNotThrow(() => c.dispose());
  });

  it('dispose() closes active fs.watch watchers created by start()', async () => {
    const { pricing, meta, fileReader } = makeStubs();
    const c = new TestConnector(pricing, meta, fileReader);
    // /tmp exists so fsWatch won't throw and a real watcher is pushed to this.watchers
    c.setDiscoverResult({ globs: ['/tmp/*.jsonl'], allowedRoots: ['/tmp'], searchedDirs: ['/tmp'] });
    await c.start();
    assert.doesNotThrow(() => c.dispose());
  });

  it('dispose() clears an active debounce timer set by a watcher callback', async () => {
    let capturedCb: (() => void) | undefined;
    const capturingWatcher: IFsWatcher = {
      watch: (_dir, cb) => { capturedCb = cb; return { close() {} }; },
    };
    const { pricing, meta, fileReader, ingestResults } = makeStubs();
    ingestResults.push(1);
    const c = new TestConnector(pricing, meta, fileReader, capturingWatcher);
    c.setDiscoverResult({ globs: ['/tmp/*.jsonl'], allowedRoots: ['/tmp'], searchedDirs: ['/tmp'] });
    await c.start();
    capturedCb!(); // scheduleReparse — sets debounceTimer
    assert.doesNotThrow(() => c.dispose()); // dispose must clearTimeout the pending timer
  });

  it('dispose() silently swallows errors thrown by watcher.close()', async () => {
    const throwingWatcher: IFsWatcher = {
      watch: () => ({ close() { throw new Error('fs error'); } }),
    };
    const { pricing, meta, fileReader } = makeStubs();
    const c = new TestConnector(pricing, meta, fileReader, throwingWatcher);
    c.setDiscoverResult({ globs: ['/tmp/*.jsonl'], allowedRoots: ['/tmp'], searchedDirs: ['/tmp'] });
    await c.start();
    assert.doesNotThrow(() => c.dispose());
  });

  it('watermark is saved after successful ingest and loaded on next run', async () => {
    const { pricing, meta, fileReader, ingestResults } = makeStubs();
    ingestResults.push(1);
    ingestResults.push(1);
    const c = new TestConnector(pricing, meta, fileReader);
    c.setDiscoverResult({ globs: ['/tmp/*.jsonl'], allowedRoots: ['/tmp'], searchedDirs: ['/tmp'] });
    await c.start();
    // Second start should use the saved watermark (loadWatermark returns non-null)
    ingestResults.push(1);
    await c.start();
    assert.equal(c.getStatus(), 'ok');
  });

  it('watermark is the max event timestamp, not the wall clock', async () => {
    const { pricing, meta, fileReader, ingestResults, state } = makeStubs();
    ingestResults.push(2);
    const c = new TestConnector(pricing, meta, fileReader);
    c.setDiscoverResult({ globs: ['/tmp/*.jsonl'], allowedRoots: ['/tmp'], searchedDirs: ['/tmp'] });
    await c.start();
    // FIXED_EVENT_TS is far in the past relative to Date.now(); saving "now"
    // instead would permanently skip late-flushed lines with older timestamps.
    assert.equal(state.watermark, String(FIXED_EVENT_TS));
  });

  it('watermark is untouched when ingest inserts nothing', async () => {
    const { pricing, meta, fileReader, state } = makeStubs();
    const c = new TestConnector(pricing, meta, fileReader);
    c.setDiscoverResult({ globs: ['/tmp/*.jsonl'], allowedRoots: ['/tmp'], searchedDirs: ['/tmp'] });
    await c.start(); // ingestResults empty → inserted 0
    assert.equal(state.watermark, null);
  });

  it('overlapping runIngest calls coalesce into one queued re-run', async () => {
    const { pricing, meta } = makeStubs();
    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;
    const slowReader = {
      ingestGlob: async () => {
        calls++;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight--;
        return { inserted: 1, maxEventTs: FIXED_EVENT_TS };
      },
      hasField: async () => false,
    } as unknown as DuckDBFileReader;
    const c = new TestConnector(pricing, meta, slowReader);
    c.setDiscoverResult({ globs: ['/tmp/*.jsonl'], allowedRoots: ['/tmp'], searchedDirs: ['/tmp'] });

    const run = (c as unknown as { runIngest(g: string[]): Promise<void> }).runIngest.bind(c);
    // First run starts; three triggers land while it is in flight.
    const p1 = run(['/tmp/*.jsonl']);
    const p2 = run(['/tmp/*.jsonl']);
    const p3 = run(['/tmp/*.jsonl']);
    const p4 = run(['/tmp/*.jsonl']);
    await Promise.all([p1, p2, p3, p4]);

    assert.equal(maxInFlight, 1, 'ingest passes must never overlap');
    assert.equal(calls, 2, 'concurrent triggers coalesce into exactly one re-run');
  });

  it('status remains "ok" after second start if events were already seen', async () => {
    const { pricing, meta, fileReader, ingestResults } = makeStubs();
    ingestResults.push(5);
    ingestResults.push(0); // second run inserts 0 — but eventsSeenEver is already true
    const c = new TestConnector(pricing, meta, fileReader);
    c.setDiscoverResult({ globs: ['/tmp/*.jsonl'], allowedRoots: ['/tmp'], searchedDirs: ['/tmp'] });
    await c.start();
    assert.equal(c.getStatus(), 'ok');
    await c.start();
    assert.equal(c.getStatus(), 'ok'); // still ok because eventsSeenEver = true
  });
});

describe('BaseFileConnector — watermarkKey', () => {
  it('exposes the watermarkKey for the concrete subclass', () => {
    const { pricing, meta, fileReader } = makeStubs();
    const c = new TestConnector(pricing, meta, fileReader);
    assert.equal((c as unknown as { watermarkKey: string }).watermarkKey, 'test:watermark');
  });
});

describe('BaseFileConnector — buildContext', () => {
  it('buildContext returns a ParseContext with pricePerCredit', async () => {
    const { pricing, meta, fileReader } = makeStubs();
    const c = new TestConnector(pricing, meta, fileReader);
    const ctx = await (c as unknown as { buildContext(g: string[]): Promise<ParseContext> }).buildContext([]);
    assert.equal(ctx.pricePerCredit, 0.04);
    assert.ok(typeof ctx.now === 'number');
  });
});
