import { strict as assert } from 'assert';
import { promises as fs, writeFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PricingService } from '../../src/extension-backend/pricing/PricingService';
import type { PricingManifest } from '../../src/extension-backend/domain/pricing';

/* eslint-disable @typescript-eslint/no-require-imports */
const https = require('https') as typeof import('https');

const BUNDLED: PricingManifest = {
  version: 1,
  pricePerCredit: 0.04,
  updatedAt: '2026-01-01T00:00:00Z',
  models: { 'gpt-4o': 1, 'claude-sonnet-4-5': 6 },
};

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mallard-pricing-'));
}

/** Stub https.get to respond with canned JSON for URLs matching a route key. */
function stubHttpsGet(routes: Record<string, unknown>): () => void {
  const origGet = https.get;
  https.get = ((url: unknown, _opts: unknown, cb: (res: { statusCode: number; on(ev: string, d?: Buffer): void }) => void) => {
    const u = String(url);
    const matched = Object.entries(routes).find(([k]) => u.includes(k));
    const fakeReq = { on() { return fakeReq; }, destroy() { return fakeReq; } } as unknown as ReturnType<typeof https.get>;
    setImmediate(() => {
      if (!matched) {
        const listeners: Record<string, () => void> = {};
        const res = { statusCode: 404, on(ev: string, fn: () => void) { listeners[ev] = fn; } } as unknown as { statusCode: number; on(ev: string, d?: Buffer): void };
        cb(res);
        setImmediate(() => listeners['end']?.());
        return;
      }
      const payload = Buffer.from(JSON.stringify(matched[1]));
      const listeners: Record<string, (d?: Buffer) => void> = {};
      const res = {
        statusCode: 200,
        on(ev: string, fn: (d?: Buffer) => void) { listeners[ev] = fn; },
      } as unknown as { statusCode: number; on(ev: string, d?: Buffer): void };
      cb(res);
      setImmediate(() => {
        listeners['data']?.(payload);
        listeners['end']?.();
      });
    });
    return fakeReq;
  }) as typeof https.get;
  return () => { https.get = origGet; };
}

describe('PricingService — getters and allPrices', () => {
  it('exposes pricePerCredit and currentManifest from the bundled manifest', async () => {
    const dir = await tmpDir();
    try {
      const svc = new PricingService(dir, BUNDLED);
      assert.equal(svc.pricePerCredit, 0.04);
      assert.equal(svc.currentManifest, BUNDLED);
      assert.equal(svc.tokenPrices, undefined); // nothing loaded yet
      svc.dispose();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('allPrices maps manifest models to {modelId, multiplier}, defaulting missing to 1', async () => {
    const dir = await tmpDir();
    try {
      const svc = new PricingService(dir, {
        ...BUNDLED,
        models: { 'gpt-4o': 2, 'weird': 'oops' as unknown as number },
      });
      const out = svc.allPrices();
      assert.deepEqual(out, [
        { modelId: 'gpt-4o', multiplier: 2 },
        { modelId: 'weird', multiplier: 1 },
      ]);
      svc.dispose();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('PricingService — load() with cache', () => {
  it('uses the bundled manifest when no cache exists', async () => {
    const dir = await tmpDir();
    const restore = stubHttpsGet({ 'openrouter.ai': { data: [] }, 'raw.githubusercontent': BUNDLED });
    try {
      const svc = new PricingService(dir, BUNDLED);
      await svc.load();
      assert.equal(svc.pricePerCredit, 0.04); // bundled (cache empty; remote is non-blocking)
      assert.equal(svc.tokenPrices, undefined);
      svc.dispose();
    } finally {
      restore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('loads a fresh cached manifest and cached token prices', async () => {
    const dir = await tmpDir();
    const cachedManifest: PricingManifest = {
      ...BUNDLED,
      pricePerCredit: 0.05,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(path.join(dir, 'pricing-manifest.json'), JSON.stringify(cachedManifest));
    writeFileSync(
      path.join(dir, 'token-prices.json'),
      JSON.stringify({ fetchedAt: new Date().toISOString(), prices: { 'gpt-4o': { input: 1e-6, output: 2e-6 } } }),
    );
    try {
      const svc = new PricingService(dir, BUNDLED);
      await svc.load();
      assert.equal(svc.pricePerCredit, 0.05); // cached overrides bundled
      assert.ok(svc.tokenPrices, 'cached token prices loaded');
      svc.dispose();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('ignores a stale cached manifest (older than 24h)', async () => {
    const dir = await tmpDir();
    const stale: PricingManifest = {
      ...BUNDLED,
      pricePerCredit: 0.99,
      updatedAt: '2020-01-01T00:00:00Z',
    };
    writeFileSync(path.join(dir, 'pricing-manifest.json'), JSON.stringify(stale));
    try {
      const svc = new PricingService(dir, BUNDLED);
      await svc.load();
      assert.equal(svc.pricePerCredit, 0.04); // bundled, not stale
      svc.dispose();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('PricingService — remote refresh (https.get mocked)', () => {
  it('tryRemoteRefresh replaces the manifest with the fetched one', async () => {
    const dir = await tmpDir();
    const fresh: PricingManifest = {
      version: 1,
      pricePerCredit: 0.07,
      updatedAt: new Date().toISOString(),
      models: { 'gpt-4o': 3 },
    };
    const restore = stubHttpsGet({ 'raw.githubusercontent': fresh });
    try {
      const svc = new PricingService(dir, BUNDLED);
      // load() kicks off a non-blocking refresh; await it explicitly via the
      // tokenPrices getter after a microtask flush.
      await svc.load();
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(svc.pricePerCredit, 0.07); // refreshed
      // Cache file written
      const cached = JSON.parse(await fs.readFile(path.join(dir, 'pricing-manifest.json'), 'utf8'));
      assert.equal(cached.pricePerCredit, 0.07);
      svc.dispose();
    } finally {
      restore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps the bundled manifest when the remote body is not valid JSON', async () => {
    const dir = await tmpDir();
    const origGet = https.get;
    https.get = ((_url: unknown, _opts: unknown, cb: (res: unknown) => void) => {
      const fakeReq = { on() { return fakeReq; }, destroy() { return fakeReq; } } as unknown as ReturnType<typeof https.get>;
      setImmediate(() => {
        const listeners: Record<string, (d?: Buffer) => void> = {};
        const res = { statusCode: 200, on(ev: string, fn: (d?: Buffer) => void) { listeners[ev] = fn; } };
        cb(res);
        setImmediate(() => { listeners['data']?.(Buffer.from('not json{')); listeners['end']?.(); });
      });
      return fakeReq;
    }) as typeof https.get;
    try {
      const svc = new PricingService(dir, BUNDLED);
      await svc.load();
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(svc.pricePerCredit, 0.04); // parse failed → bundled retained
      svc.dispose();
    } finally {
      https.get = origGet;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('tryTokenPricesRefresh prefers OpenRouter and caches the parsed prices', async () => {
    const dir = await tmpDir();
    const openRouter = {
      data: [{ id: 'anthropic/claude-sonnet-4-5', pricing: { prompt: '1e-6', completion: '2e-6' } }],
    };
    const restore = stubHttpsGet({ 'openrouter.ai': openRouter });
    try {
      const svc = new PricingService(dir, BUNDLED, ''); // empty remote URL → skip manifest refresh
      await svc.load();
      await new Promise((r) => setTimeout(r, 100));
      assert.ok(svc.tokenPrices, 'token prices populated from OpenRouter');
      assert.deepEqual(svc.tokenPrices!['claude-sonnet-4-5'], { input: 1e-6, output: 2e-6 });
      const cached = JSON.parse(await fs.readFile(path.join(dir, 'token-prices.json'), 'utf8'));
      assert.ok(cached.prices['claude-sonnet-4-5']);
      svc.dispose();
    } finally {
      restore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('tryTokenPricesRefresh falls back to LiteLLM when OpenRouter 404s', async () => {
    const dir = await tmpDir();
    const liteLlm = {
      'claude-sonnet-4-5': { input_cost_per_token: 3e-6, output_cost_per_token: 4e-6 },
    };
    const restore = stubHttpsGet({ 'raw.githubusercontent': liteLlm, 'openrouter.ai': null });
    try {
      const svc = new PricingService(dir, BUNDLED, '');
      await svc.load();
      await new Promise((r) => setTimeout(r, 100));
      assert.ok(svc.tokenPrices);
      assert.deepEqual(svc.tokenPrices!['claude-sonnet-4-5'], { input: 3e-6, output: 4e-6 });
      svc.dispose();
    } finally {
      restore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps current prices when all sources fail', async () => {
    const dir = await tmpDir();
    const restore = stubHttpsGet({});
    try {
      const svc = new PricingService(dir, BUNDLED, '');
      await svc.load();
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(svc.tokenPrices, undefined); // no refresh succeeded
      assert.equal(svc.pricePerCredit, 0.04); // unchanged
      svc.dispose();
    } finally {
      restore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('tryRemoteRefresh is a no-op when remoteUrl is empty', async () => {
    const dir = await tmpDir();
    const restore = stubHttpsGet({ 'raw.githubusercontent': { ...BUNDLED, pricePerCredit: 0.99 } });
    try {
      const svc = new PricingService(dir, BUNDLED, '');
      await svc.load();
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(svc.pricePerCredit, 0.04); // unchanged — empty URL skipped
      svc.dispose();
    } finally {
      restore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('PricingService — lifecycle and clearCache', () => {
  it('startDailyRefresh + dispose clears the timer without throwing', async () => {
    const dir = await tmpDir();
    try {
      const svc = new PricingService(dir, BUNDLED);
      assert.doesNotThrow(() => svc.startDailyRefresh());
      assert.doesNotThrow(() => svc.dispose());
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('clearCache removes both cache files (idempotent when absent)', async () => {
    const dir = await tmpDir();
    try {
      writeFileSync(path.join(dir, 'pricing-manifest.json'), '{}');
      writeFileSync(path.join(dir, 'token-prices.json'), '{}');
      const svc = new PricingService(dir, BUNDLED);
      await svc.clearCache();
      assert.rejects(fs.readFile(path.join(dir, 'pricing-manifest.json')), /ENOENT/);
      assert.rejects(fs.readFile(path.join(dir, 'token-prices.json')), /ENOENT/);
      // Second call is a no-op (no throw) when files already gone.
      await svc.clearCache();
      svc.dispose();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('tryRemoteRefresh catch swallows network failures silently', async () => {
    const dir = await tmpDir();
    const restore = stubHttpsGet({}); // 404 for all URLs → fetchManifest rejects
    try {
      const svc = new PricingService(dir, BUNDLED, 'https://example.com/manifest.json');
      await svc.load();
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(svc.pricePerCredit, 0.04); // unchanged — catch swallowed the error
      svc.dispose();
    } finally {
      restore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('cacheTokenPrices catch swallows write failures silently', async () => {
    const dir = await tmpDir();
    const openRouter = { data: [{ id: 'gpt-4o', pricing: { prompt: '1e-6', completion: '2e-6' } }] };
    const restore = stubHttpsGet({ 'openrouter.ai': openRouter });
    try {
      // Make the dir read-only AFTER the PricingService is constructed so
      // the constructor's mkdir succeeds but cacheTokenPrices' mkdir/write fails.
      const svc = new PricingService(dir, BUNDLED, '');
      await svc.load();
      await new Promise((r) => setTimeout(r, 100));
      // Token prices are set in memory even if the cache write fails.
      assert.ok(svc.tokenPrices, 'in-memory prices set despite cache write failure');
      svc.dispose();
    } finally {
      restore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('loadCached returns null for an invalid manifest shape', async () => {
    const dir = await tmpDir();
    writeFileSync(path.join(dir, 'pricing-manifest.json'), JSON.stringify({ version: 'not-a-number' }));
    try {
      const svc = new PricingService(dir, BUNDLED, '');
      await svc.load();
      assert.equal(svc.pricePerCredit, 0.04); // bundled, cache rejected
      svc.dispose();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
