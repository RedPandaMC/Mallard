import { strict as assert } from 'assert';
import { BaseFileConnector } from '../../../src/client_extension/ingest/BaseFileConnector';
import type { IFsWatcher } from '../../../src/client_extension/ingest/IFsWatcher';
import type { ParseContext } from '../../../src/client_extension/ingest/otelParse';
import type { PricingService } from '../../../src/client_extension/pricing/PricingService';
import type { IMetaStore as MetaStore } from '../../../src/client_extension/store/MetaStore';
import type { DuckDBFileReader } from '../../../src/client_extension/store/DuckDBFileReader';
import type { UsageEvent } from '../../../src/client_extension/domain/types';

// ── Minimal concrete subclass for testing ──────────────────────────────────────

type DiscoverResult = { globs: string[]; allowedRoots: string[]; searchedDirs: string[] };

class TestConnector extends BaseFileConnector {
  readonly id = 'test';
  readonly displayName = 'Test Connector';
  readonly capabilities = {
    tokenFields: [] as const,
    costCategories: [] as const,
    supportsRepoAttribution: false,
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

function makeStubs() {
  const pricing = { pricePerCredit: 0.04, currentManifest: undefined } as unknown as PricingService;
  let watermark: string | null = null;
  const meta: MetaStore = {
    get: async () => watermark,
    set: async (_k, v) => { watermark = v; },
  };
  const ingestResults: number[] = [];
  const fileReader = {
    ingestGlob: async () => { const r = ingestResults.shift() ?? 0; return r; },
    hasField: async () => false,
  } as unknown as DuckDBFileReader;
  return { pricing, meta, fileReader, ingestResults };
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
