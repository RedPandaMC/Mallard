import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  FanoutMetricExporter,
  MetricExporter,
  type MetricProtocol,
  type MetricSerializer,
  type SendResult,
} from '../../src/extension-backend/export/MetricExporter';
import { ExportQueue } from '../../src/extension-backend/export/ExportQueue';
import type { UsageSnapshot } from '../../src/extension-backend/domain/types';
import { webhookTargetSlots, SECRET_KEYS } from '../../src/extension-backend/app/credentials';

function proto() {
  const calls: Array<Record<string, unknown>> = [];
  let result: SendResult = { ok: true };
  const p: MetricProtocol & { calls: typeof calls; setResult(r: SendResult): void; disposed: boolean } = {
    calls,
    disposed: false,
    setResult(r) { result = r; },
    async send(_topic, payload) { calls.push(payload); return result; },
    dispose() { this.disposed = true; },
  };
  return p;
}

/** Serializer returning a fresh, distinct payload per export() call. */
function serializerFor(payloads: Array<Record<string, unknown>>): MetricSerializer {
  let i = 0;
  return { topic: 't', serialize: () => payloads[i++]! };
}

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mallard-fanout-'));
}

describe('FanoutMetricExporter — per-target queues', () => {
  const snap = {} as UsageSnapshot;

  it('re-delivers only to the failed target, never re-sending to one that succeeded', async () => {
    const dir = await tmpDir();
    const a = proto();
    const b = proto();
    const ea = new MetricExporter(a, serializerFor([{ n: 1 }, { n: 2 }]), new ExportQueue(dir, 'a.json'));
    const eb = new MetricExporter(b, serializerFor([{ n: 1 }, { n: 2 }]), new ExportQueue(dir, 'b.json'));
    const fanout = new FanoutMetricExporter([ea, eb]);

    // First export: A succeeds, B is temporarily down (retryable) → queued for B only.
    b.setResult({ ok: false, retryable: true });
    await fanout.export(snap);

    // Second export: B recovers.
    b.setResult({ ok: true });
    await fanout.export(snap);

    // A saw payload 1 exactly once (no double-delivery) and payload 2 once.
    assert.deepEqual(a.calls, [{ n: 1 }, { n: 2 }]);
    // B retried the queued payload 1, then sent payload 2.
    assert.deepEqual(b.calls, [{ n: 1 }, { n: 1 }, { n: 2 }]);
  });

  it('dispose() disposes every child exporter', () => {
    const a = proto();
    const b = proto();
    const ea = new MetricExporter(a, serializerFor([]));
    const eb = new MetricExporter(b, serializerFor([]));
    new FanoutMetricExporter([ea, eb]).dispose();
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
