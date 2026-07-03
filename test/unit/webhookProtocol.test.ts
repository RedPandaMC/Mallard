import { strict as assert } from 'assert';
import * as crypto from 'crypto';
import { WebhookProtocol } from '../../src/extension-backend/export/WebhookProtocol';

const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };

describe('WebhookProtocol — HMAC request signing', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  function captureFetch() {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    globalThis.fetch = (async (url: unknown, init: RequestInit) => {
      calls.push({
        url: String(url),
        headers: init.headers as Record<string, string>,
        body: String(init.body),
      });
      return { status: 202 } as Response;
    }) as typeof fetch;
    return calls;
  }

  it('emits a deterministic X-Mallard-Signature-256 header when a secret is set', async () => {
    const calls = captureFetch();
    const protocol = new WebhookProtocol(
      { url: 'https://example.com/ingest', secret: 'test-signing-secret', retries: 0 },
      quietLogger,
    );

    const payload = { schema_version: 2, instance_id: 'abc', ts: 1_700_000_000_000 };
    const result = await protocol.send('mallard/v2/metrics', payload);
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
    await protocol.send('mallard/v2/metrics', { schema_version: 2 });
    assert.equal(calls.length, 1);
    assert.ok(!('X-Mallard-Signature-256' in calls[0]!.headers));
    protocol.dispose();
  });
});
