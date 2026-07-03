import { strict as assert } from 'assert';
import { FanoutProtocol } from '../../src/extension-backend/export/ExporterFactory';
import type { MetricProtocol, SendResult } from '../../src/extension-backend/export/MetricExporter';
import { webhookTargetSlots, SECRET_KEYS } from '../../src/extension-backend/app/credentials';

function proto(result: SendResult) {
  const calls: Array<{ topic: string; payload: Record<string, unknown> }> = [];
  const p: MetricProtocol & { calls: typeof calls; disposed: boolean } = {
    calls,
    disposed: false,
    async send(topic, payload) {
      calls.push({ topic, payload });
      return result;
    },
    dispose() { this.disposed = true; },
  };
  return p;
}

describe('FanoutProtocol — multi-server webhook export', () => {
  const payload = { schema_version: 3 };

  it('sends the same payload to every target and reports ok when all succeed', async () => {
    const a = proto({ ok: true });
    const b = proto({ ok: true });
    const fanout = new FanoutProtocol([a, b]);
    const result = await fanout.send('t', payload);
    assert.deepEqual(result, { ok: true });
    assert.equal(a.calls.length, 1);
    assert.equal(b.calls.length, 1);
    assert.deepEqual(a.calls[0], { topic: 't', payload });
  });

  it('is retryable when the only failures are retryable (e.g. one server down)', async () => {
    const ok = proto({ ok: true });
    const down = proto({ ok: false, retryable: true });
    const result = await new FanoutProtocol([ok, down]).send('t', payload);
    assert.deepEqual(result, { ok: false, retryable: true });
  });

  it('is fatal when any target fails fatally (bad credential must not spin the queue)', async () => {
    const ok = proto({ ok: true });
    const retriable = proto({ ok: false, retryable: true });
    const fatal = proto({ ok: false, retryable: false });
    const result = await new FanoutProtocol([ok, retriable, fatal]).send('t', payload);
    assert.deepEqual(result, { ok: false, retryable: false });
  });

  it('dispose() disposes every wrapped protocol', () => {
    const a = proto({ ok: true });
    const b = proto({ ok: true });
    new FanoutProtocol([a, b]).dispose();
    assert.equal(a.disposed, true);
    assert.equal(b.disposed, true);
  });
});

describe('webhookTargetSlots — per-target credential slots', () => {
  it('produces api-key, bearer, and signing slots per target, namespaced by name', () => {
    const slots = webhookTargetSlots([{ name: 'team' }, { name: 'ci' }]);
    assert.equal(slots.length, 6);
    const keys = slots.map((s) => s.key);
    assert.ok(keys.includes(`${SECRET_KEYS.webhookApiKey}:team`));
    assert.ok(keys.includes(`${SECRET_KEYS.webhookBearerToken}:team`));
    assert.ok(keys.includes(`${SECRET_KEYS.webhookSigningSecret}:ci`));
    assert.equal(new Set(keys).size, 6, 'keys must be unique across targets');
  });

  it('returns no slots for no targets', () => {
    assert.deepEqual(webhookTargetSlots([]), []);
  });
});
