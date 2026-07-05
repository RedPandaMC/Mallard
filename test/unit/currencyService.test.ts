import { strict as assert } from 'assert';
import { promises as fs, writeFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CurrencyService } from '../../src/extension-backend/pricing/CurrencyService';

/* eslint-disable @typescript-eslint/no-require-imports */
const https = require('https') as typeof import('https');

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mallard-currency-'));
}

function stubHttpsGet(response: unknown | null): () => void {
  const origGet = https.get;
  https.get = ((_url: unknown, _opts: unknown, cb: (res: { statusCode: number; on(ev: string, d?: Buffer): void }) => void) => {
    const fakeReq = { on() { return fakeReq; }, destroy() { return fakeReq; } } as unknown as ReturnType<typeof https.get>;
    setImmediate(() => {
      if (!response) {
        const res = { statusCode: 404, headers: {}, resume(): void {}, on(): void {} } as unknown as { statusCode: number; on(ev: string, d?: Buffer): void };
        cb(res);
        setImmediate(() => (res as unknown as { on(ev: string, fn: () => void): void }).on('end', () => {}));
        return;
      }
      const payload = Buffer.from(JSON.stringify(response));
      const listeners: Record<string, (d?: Buffer) => void> = {};
      const res = {
        statusCode: 200,
        headers: {},
        resume(): void {},
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

interface FakeRes { statusCode: number; headers?: Record<string, string>; body?: string }

/** Flexible https.get stub: `route(url)` decides the response, so a redirect
 *  response triggers a second https.get the stub answers with the next route. */
function stubHttps(route: (url: string) => FakeRes): () => void {
  const orig = https.get;
  https.get = ((url: string, _opts: unknown, cb: (res: unknown) => void) => {
    const fakeReq = { on() { return fakeReq; }, destroy() { return fakeReq; } } as unknown as ReturnType<typeof https.get>;
    setImmediate(() => {
      const r = route(String(url));
      const listeners: Record<string, (d?: Buffer) => void> = {};
      const res = {
        statusCode: r.statusCode,
        headers: r.headers ?? {},
        resume(): void {},
        on(ev: string, fn: (d?: Buffer) => void) { listeners[ev] = fn; return res; },
      };
      cb(res);
      setImmediate(() => {
        if (r.body !== undefined) listeners['data']?.(Buffer.from(r.body));
        listeners['end']?.();
      });
    });
    return fakeReq;
  }) as typeof https.get;
  return () => { https.get = orig; };
}

describe('CurrencyService', () => {
  it('currentRates returns USD:1 by default before load', async () => {
    const dir = await tmpDir();
    try {
      const svc = new CurrencyService(dir);
      assert.deepEqual(svc.currentRates(), { USD: 1 });
      svc.dispose();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('load() fetches rates from Frankfurter and caches them', async () => {
    const dir = await tmpDir();
    const restore = stubHttpsGet({ rates: { EUR: 0.92, JPY: 150 } });
    try {
      const svc = new CurrencyService(dir);
      await svc.load();
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(svc.currentRates()['EUR'], 0.92);
      assert.equal(svc.currentRates()['USD'], 1);
      const cached = JSON.parse(await fs.readFile(path.join(dir, 'fx-rates.json'), 'utf8'));
      assert.ok(cached.rates['EUR']);
      svc.dispose();
    } finally {
      restore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('load() uses a fresh cached file without fetching', async () => {
    const dir = await tmpDir();
    writeFileSync(
      path.join(dir, 'fx-rates.json'),
      JSON.stringify({ fetchedAt: new Date().toISOString(), rates: { USD: 1, EUR: 0.9 } }),
    );
    // Fresh cache still fires a background refresh; stub it (failing) so the
    // test makes no real network call.
    const restore = stubHttps(() => ({ statusCode: 404 }));
    try {
      const svc = new CurrencyService(dir);
      await svc.load();
      assert.equal(svc.currentRates()['EUR'], 0.9);
      svc.dispose();
    } finally {
      restore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('ignores a stale cache (>24h) and falls back to USD-only on fetch failure', async () => {
    const dir = await tmpDir();
    writeFileSync(
      path.join(dir, 'fx-rates.json'),
      JSON.stringify({ fetchedAt: '2020-01-01T00:00:00Z', rates: { USD: 1, EUR: 0.9 } }),
    );
    const restore = stubHttpsGet(null);
    try {
      const svc = new CurrencyService(dir);
      await svc.load();
      await new Promise((r) => setTimeout(r, 100));
      assert.deepEqual(svc.currentRates(), { USD: 1 });
      svc.dispose();
    } finally {
      restore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('startDailyRefresh + dispose clears the timer', async () => {
    const dir = await tmpDir();
    try {
      const svc = new CurrencyService(dir);
      assert.doesNotThrow(() => svc.startDailyRefresh());
      assert.doesNotThrow(() => svc.dispose());
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('clearCache removes the cache file (idempotent)', async () => {
    const dir = await tmpDir();
    try {
      writeFileSync(path.join(dir, 'fx-rates.json'), '{}');
      const svc = new CurrencyService(dir);
      await svc.clearCache();
      await assert.rejects(fs.readFile(path.join(dir, 'fx-rates.json')), /ENOENT/);
      await svc.clearCache();
      svc.dispose();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('loadCached returns null for a non-object cache file', async () => {
    const dir = await tmpDir();
    writeFileSync(path.join(dir, 'fx-rates.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), rates: 'not-an-object' }));
    // Cache is rejected → cold path awaits a fetch; stub it to fail so the
    // result is deterministic (no real network).
    const restore = stubHttps(() => ({ statusCode: 404 }));
    try {
      const svc = new CurrencyService(dir);
      await svc.load();
      assert.deepEqual(svc.currentRates(), { USD: 1 }); // cache rejected, fetch failed
      svc.dispose();
    } finally {
      restore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('cold load (no cache) awaits the fetch so rates are ready immediately', async () => {
    const dir = await tmpDir();
    const restore = stubHttps(() => ({ statusCode: 200, body: JSON.stringify({ rates: { EUR: 0.8 } }) }));
    try {
      const svc = new CurrencyService(dir);
      await svc.load();
      // No post-load setTimeout: the cold path awaits tryRefresh().
      assert.equal(svc.currentRates()['EUR'], 0.8);
      svc.dispose();
    } finally {
      restore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('follows redirects to resolve rates', async () => {
    const dir = await tmpDir();
    const restore = stubHttps((url) =>
      url.includes('frankfurter.app')
        ? { statusCode: 302, headers: { location: 'https://api.frankfurter.dev/latest?from=USD' } }
        : { statusCode: 200, body: JSON.stringify({ rates: { GBP: 0.79 } }) },
    );
    try {
      const svc = new CurrencyService(dir);
      await svc.load();
      assert.equal(svc.currentRates()['GBP'], 0.79);
      svc.dispose();
    } finally {
      restore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('gives up after too many redirects and logs the failure', async () => {
    const dir = await tmpDir();
    const restore = stubHttps(() => ({ statusCode: 302, headers: { location: 'https://api.frankfurter.app/latest?from=USD' } }));
    const debugs: string[] = [];
    const logger = { debug: (_t: string, m: string) => debugs.push(String(m)), warn() {}, info() {}, error() {} };
    try {
      const svc = new CurrencyService(dir, logger as never);
      await svc.load();
      assert.deepEqual(svc.currentRates(), { USD: 1 });
      assert.ok(debugs.some((m) => /redirect/i.test(m)), 'logs the redirect failure');
      svc.dispose();
    } finally {
      restore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects an unexpected response shape (USD-only)', async () => {
    const dir = await tmpDir();
    const restore = stubHttps(() => ({ statusCode: 200, body: JSON.stringify({ notRates: true }) }));
    try {
      const svc = new CurrencyService(dir);
      await svc.load();
      assert.deepEqual(svc.currentRates(), { USD: 1 });
      svc.dispose();
    } finally {
      restore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects an unparseable body (USD-only)', async () => {
    const dir = await tmpDir();
    const restore = stubHttps(() => ({ statusCode: 200, body: 'not json{' }));
    try {
      const svc = new CurrencyService(dir);
      await svc.load();
      assert.deepEqual(svc.currentRates(), { USD: 1 });
      svc.dispose();
    } finally {
      restore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('writeCache catch swallows write failures (read-only dir)', async () => {
    const dir = await tmpDir();
    const restore = stubHttpsGet({ rates: { EUR: 0.92 } });
    try {
      const svc = new CurrencyService(dir);
      await svc.load();
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(svc.currentRates()['EUR'], 0.92); // in-memory set despite write failure
      svc.dispose();
    } finally {
      restore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
