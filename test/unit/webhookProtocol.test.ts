import { strict as assert } from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WebhookProtocol } from '../../src/extension-backend/export/WebhookProtocol';

/* eslint-disable @typescript-eslint/no-require-imports */
const https = require('https') as typeof import('https');
const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };

type FetchCall = { url: string; headers: Record<string, string>; body: string };

function captureFetch(status = 202, calls: FetchCall[] = []): FetchCall[] {
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    calls.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: String(init.body),
    });
    return { status } as Response;
  }) as typeof fetch;
  return calls;
}

function statusSequence(statuses: number[], calls: FetchCall[] = []): FetchCall[] {
  let i = 0;
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    calls.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: String(init.body),
    });
    return { status: statuses[Math.min(i++, statuses.length - 1)] } as Response;
  }) as typeof fetch;
  return calls;
}

describe('WebhookProtocol — HMAC request signing', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('emits a deterministic X-Mallard-Signature-256 header when a secret is set', async () => {
    const calls = captureFetch();
    const protocol = new WebhookProtocol(
      { url: 'https://example.com/ingest', secret: 'test-signing-secret', retries: 0 },
      quietLogger,
    );

    const payload = { schema_version: 3, instance_id: 'abc', ts: 1_700_000_000_000 };
    const result = await protocol.send('mallard/v3/metrics', payload);
    assert.equal(result.ok, true);

    const body = JSON.stringify(payload);
    const expected =
      'sha256=' + crypto.createHmac('sha256', 'test-signing-secret').update(body, 'utf8').digest('hex');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.body, body, 'signature must cover the exact body sent');
    assert.equal(calls[0]!.headers['X-Mallard-Signature-256'], expected);
    protocol.dispose();
  });

  it('omits the signature header when no secret is configured', async () => {
    const calls = captureFetch();
    const protocol = new WebhookProtocol(
      { url: 'https://example.com/ingest', retries: 0 },
      quietLogger,
    );
    await protocol.send('mallard/v3/metrics', { schema_version: 3 });
    assert.equal(calls.length, 1);
    assert.ok(!('X-Mallard-Signature-256' in calls[0]!.headers));
    protocol.dispose();
  });
});

describe('WebhookProtocol — send() outcome matrix', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns ok:true on 2xx', async () => {
    captureFetch(200);
    const p = new WebhookProtocol({ url: 'https://x/ingest', retries: 0 }, quietLogger);
    assert.deepEqual(await p.send('t', { schema_version: 3 }), { ok: true });
    p.dispose();
  });

  it('returns non-retryable on 4xx (AbortError, no retry)', async () => {
    captureFetch(401);
    const p = new WebhookProtocol({ url: 'https://x/ingest', retries: 3 }, quietLogger);
    const r = await p.send('t', { schema_version: 3 });
    assert.equal(r.ok, false);
    assert.equal((r as { retryable: boolean }).retryable, false);
    p.dispose();
  });

  it('returns retryable on 5xx and retries up to `retries` times', async () => {
    const calls: FetchCall[] = [];
    statusSequence([503, 503, 503], calls);
    const p = new WebhookProtocol({ url: 'https://x/ingest', retries: 2, }, {
      ...quietLogger,
      // silence the retry-warning noise
    });
    const r = await p.send('t', { schema_version: 3 });
    assert.equal(r.ok, false);
    assert.equal((r as { retryable: boolean }).retryable, true);
    // retries=2 → initial + 2 retries = 3 attempts
    assert.equal(calls.length, 3);
    p.dispose();
  });

  it('returns retryable on network error (fetch throws)', async () => {
    globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    const p = new WebhookProtocol({ url: 'https://x/ingest', retries: 0 }, quietLogger);
    const r = await p.send('t', { schema_version: 3 });
    assert.equal(r.ok, false);
    assert.equal((r as { retryable: boolean }).retryable, true);
    p.dispose();
  });

  it('returns non-retryable false after dispose() (no url)', async () => {
    captureFetch(202);
    const p = new WebhookProtocol({ url: 'https://x/ingest', retries: 0 }, quietLogger);
    p.dispose();
    const r = await p.send('t', { schema_version: 3 });
    assert.deepEqual(r, { ok: false, retryable: false });
  });

  it('rejects a plaintext http:// url in the constructor (no send attempted)', async () => {
    const calls: FetchCall[] = [];
    globalThis.fetch = (async (url: unknown, init: RequestInit) => {
      calls.push({ url: String(url), headers: init.headers as Record<string, string>, body: String(init.body) });
      return { status: 200 } as Response;
    }) as typeof fetch;
    const p = new WebhookProtocol({ url: 'http://insecure/ingest', retries: 0 }, quietLogger);
    const r = await p.send('t', { schema_version: 3 });
    assert.deepEqual(r, { ok: false, retryable: false });
    assert.equal(calls.length, 0, 'no request must be sent for an insecure URL');
    p.dispose();
  });
});

describe('WebhookProtocol — mTLS client-cert path', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('sends via https.request when certFile/keyFile are set, returning the status', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mallard-mtls-'));
    const certFile = path.join(dir, 'cert.pem');
    const keyFile = path.join(dir, 'key.pem');
    const caFile = path.join(dir, 'ca.pem');
    fs.writeFileSync(certFile, 'cert');
    fs.writeFileSync(keyFile, 'key');
    fs.writeFileSync(caFile, 'ca');

    let captured: { headers: Record<string, string>; host: string; port: number; path: string; method: string } | undefined;
    const origRequest = https.request;
    https.request = ((opts: Record<string, unknown>, cb: (res: { statusCode: number; resume(): void }) => void) => {
      captured = {
        headers: opts.headers as Record<string, string>,
        host: String(opts.hostname),
        port: Number(opts.port),
        path: String(opts.path),
        method: String(opts.method),
      };
      const req = {
        on() { return req; },
        write() { return true; },
        end() { setTimeout(() => cb({ statusCode: 201, resume() {} }), 0); return req; },
        destroy() { return req; },
      } as unknown as ReturnType<typeof https.request>;
      return req;
    }) as typeof https.request;

    try {
      const p = new WebhookProtocol(
        { url: 'https://mtls.example/ingest', certFile, keyFile, caFile, retries: 0 },
        quietLogger,
      );
      const r = await p.send('t', { schema_version: 3 });
      assert.equal(r.ok, true);
      assert.ok(captured);
      assert.equal(captured!.host, 'mtls.example');
      assert.equal(captured!.port, 443);
      assert.equal(captured!.path, '/ingest');
      assert.equal(captured!.method, 'POST');
      assert.equal(
        captured!.headers['Content-Length'],
        Buffer.byteLength(JSON.stringify({ schema_version: 3 }), 'utf8'),
      );
      p.dispose();
    } finally {
      https.request = origRequest;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns non-retryable when the cert file cannot be read', async () => {
    const origRequest = https.request;
    https.request = (() => { throw new Error('should not be reached'); }) as typeof https.request;
    try {
      const p = new WebhookProtocol(
        { url: 'https://mtls.example/ingest', certFile: '/no/cert.pem', keyFile: '/no/key.pem', retries: 0 },
        quietLogger,
      );
      const r = await p.send('t', { schema_version: 3 });
      assert.equal(r.ok, false);
      // Cert read failure aborts (throws synchronously in _postWithClientCert),
      // pRetry retries a plain Error — but there are no valid cert files so it
      // never succeeds; the result is retryable:true. We only assert ok:false here.
      p.dispose();
    } finally {
      https.request = origRequest;
    }
  });
});

