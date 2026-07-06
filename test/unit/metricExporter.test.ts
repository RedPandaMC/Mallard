/**
 * Tests for the MetricExporter DI orchestrator pattern and MetricPayloadSerializer.
 *
 * MetricExporter.ts imports `vscode` (for MqttProtocol), so we cannot import
 * that file in the node unit-test runner. Instead:
 *   - The MetricExporter orchestrator (flush-then-send against a queue) is
 *     mirrored by a local re-implementation using a fake protocol — keep the
 *     two in sync if the real algorithm changes.
 *   - ExportQueue itself has no vscode/mqtt import, so it's used for real
 *     here (against a temp dir) rather than faked a third time, so a bug fix
 *     to the queue benefits both this suite and exportQueue.test.ts.
 *   - MetricPayloadSerializer lives in payload.ts which has only a type-only import
 *     of MetricSerializer, so it is safe to import here.
 *
 * MqttProtocol and createMetricExporter (which both need vscode) are covered
 * by the integration test suite.
 */
import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MetricPayloadSerializer } from '../../src/extension-backend/export/payload';
import { buildSnapshot } from '../../src/extension-backend/domain/snapshot';
import { makeEvent } from './helpers';
import { ExportQueue } from '../../src/extension-backend/export/ExportQueue';
import type { MetricProtocol, MetricSerializer, SendResult } from '../../src/extension-backend/export/MetricExporter';
// The real classes are importable now that vscode + mqtt are stubbed by the
// mocharc require hooks — exercise them directly so flushQueue and the null
// exporter are covered (not just the mirrored stub above).
import { MetricExporter, NullMetricExporter } from '../../src/extension-backend/export/MetricExporter';

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mallard-metricexporter-test-'));
}

// ── Minimal local re-implementation of MetricExporter (vscode/mqtt-free) ─────
// Mirrors MetricExporter.ts's flush-then-send algorithm.

class MetricExporterStub {
  private flushing = false;
  private disposed = false;
  private protocol: MetricProtocol;
  private serializer: MetricSerializer;
  private queue: ExportQueue | undefined;

  constructor(protocol: MetricProtocol, serializer: MetricSerializer, queue?: ExportQueue) {
    this.protocol = protocol;
    this.serializer = serializer;
    this.queue = queue;
  }

  async export(snapshot: Parameters<MetricSerializer['serialize']>[0]): Promise<void> {
    if (this.flushing || this.disposed) return;
    this.flushing = true;
    try {
      const stillDown = this.queue ? await this.flushQueue() : false;
      if (this.disposed) return;

      const topic = this.serializer.topic;
      const payload = this.serializer.serialize(snapshot);

      if (stillDown) {
        this.queue?.enqueue(topic, payload);
        return;
      }

      const result = await this.protocol.send(topic, payload);
      if (this.disposed) return;
      if (!result.ok && result.retryable) {
        this.queue?.enqueue(topic, payload);
      }
    } finally {
      this.flushing = false;
    }
  }

  private async flushQueue(): Promise<boolean> {
    if (!this.queue) return false;
    for (const entry of this.queue.peekAll()) {
      const result = await this.protocol.send(entry.topic, entry.payload);
      if (this.disposed) return true;
      if (result.ok) {
        this.queue.dequeue(entry.id);
        continue;
      }
      if (result.retryable) return true;
      this.queue.dequeue(entry.id);
    }
    return false;
  }

  dispose(): void {
    this.disposed = true;
    this.protocol.dispose();
  }
}

// ── Fakes ─────────────────────────────────────────────────────────────────────

interface Call { topic: string; payload: Record<string, unknown> }

/** Scripted results are consumed in order; once exhausted, further sends succeed. */
function fakeProtocol(results: SendResult[] = []): MetricProtocol & { calls: Call[]; disposed: boolean } {
  const calls: Call[] = [];
  let disposed = false;
  let i = 0;
  return {
    calls,
    get disposed() { return disposed; },
    async send(topic, payload) {
      calls.push({ topic, payload });
      const result = i < results.length ? results[i]! : { ok: true as const };
      i++;
      return result;
    },
    dispose() { disposed = true; },
  };
}

function fakeSerializer(topic = 'test/topic'): MetricSerializer & { serializeCalled: boolean } {
  let serializeCalled = false;
  return {
    topic,
    get serializeCalled() { return serializeCalled; },
    serialize(snapshot) {
      serializeCalled = true;
      return { ts: new Date(snapshot.generatedAt).toISOString() };
    },
  };
}

function makeSnapshot() {
  return buildSnapshot(
    [makeEvent({ ts: Date.now() - 1000, modelId: 'gpt-4o', credits: 5 })],
    {
      now: Date.now(),
      currency: 'USD',
      pricePerCredit: 0.04,
      monthlyBudget: null,
      includedCredits: 300,
      filter: {},
      source: 'local',
      status: { kind: 'ok' },
      authStatus: 'signed-out',
    },
  );
}

// ── MetricExporter DI contract ────────────────────────────────────────────────

describe('MetricExporter (DI orchestrator)', () => {
  it('export() calls protocol.send with the serializer topic and payload', async () => {
    const protocol = fakeProtocol();
    const serializer = fakeSerializer('my/topic');
    const exporter = new MetricExporterStub(protocol, serializer);

    await exporter.export(makeSnapshot());

    assert.equal(protocol.calls.length, 1);
    assert.equal(protocol.calls[0]!.topic, 'my/topic');
    assert.ok('ts' in protocol.calls[0]!.payload);
  });

  it('export() invokes serializer.serialize', async () => {
    const protocol = fakeProtocol();
    const serializer = fakeSerializer();
    const exporter = new MetricExporterStub(protocol, serializer);
    await exporter.export(makeSnapshot());
    assert.equal(serializer.serializeCalled, true);
  });

  it('dispose() calls protocol.dispose', () => {
    const protocol = fakeProtocol();
    const exporter = new MetricExporterStub(protocol, fakeSerializer());
    exporter.dispose();
    assert.equal(protocol.disposed, true);
  });

  it('multiple exports accumulate in protocol calls', async () => {
    const protocol = fakeProtocol();
    const exporter = new MetricExporterStub(protocol, fakeSerializer());
    const snap = makeSnapshot();
    await exporter.export(snap);
    await exporter.export(snap);
    assert.equal(protocol.calls.length, 2);
  });
});

// ── MetricExporter + ExportQueue integration ─────────────────────────────────

describe('MetricExporter (offline queue + retry)', () => {
  it('a retryable failure enqueues the payload', async () => {
    const dir = await makeTmpDir();
    const queue = new ExportQueue(dir);
    const protocol = fakeProtocol([{ ok: false, retryable: true }]);
    const exporter = new MetricExporterStub(protocol, fakeSerializer(), queue);

    await exporter.export(makeSnapshot());

    assert.equal(queue.peekAll().length, 1);
    await fs.rm(dir, { recursive: true });
  });

  it('a fatal (non-retryable) failure does not enqueue', async () => {
    const dir = await makeTmpDir();
    const queue = new ExportQueue(dir);
    const protocol = fakeProtocol([{ ok: false, retryable: false }]);
    const exporter = new MetricExporterStub(protocol, fakeSerializer(), queue);

    await exporter.export(makeSnapshot());

    assert.equal(queue.peekAll().length, 0);
    await fs.rm(dir, { recursive: true });
  });

  it('flushes queued entries oldest-first before sending the new payload', async () => {
    const dir = await makeTmpDir();
    const queue = new ExportQueue(dir);
    queue.enqueue('t', { n: 1 });
    queue.enqueue('t', { n: 2 });
    const protocol = fakeProtocol(); // everything succeeds
    const exporter = new MetricExporterStub(protocol, fakeSerializer(), queue);

    await exporter.export(makeSnapshot());

    // two queued entries flushed, then the new payload sent — three sends total.
    assert.equal(protocol.calls.length, 3);
    assert.deepEqual(protocol.calls[0]!.payload, { n: 1 });
    assert.deepEqual(protocol.calls[1]!.payload, { n: 2 });
    assert.equal(queue.peekAll().length, 0);
    await fs.rm(dir, { recursive: true });
  });

  it('stops flushing at the first still-retryable entry and skips the new send', async () => {
    const dir = await makeTmpDir();
    const queue = new ExportQueue(dir);
    queue.enqueue('t', { n: 1 });
    queue.enqueue('t', { n: 2 });
    // First flush attempt fails (still down); would-be later calls aren't reached.
    const protocol = fakeProtocol([{ ok: false, retryable: true }]);
    const exporter = new MetricExporterStub(protocol, fakeSerializer(), queue);

    await exporter.export(makeSnapshot());

    // Only the first queued entry was attempted — the new payload was never sent,
    // just enqueued directly behind the still-queued backlog, in order.
    assert.equal(protocol.calls.length, 1);
    const remaining = queue.peekAll();
    assert.equal(remaining.length, 3, 'both original entries plus the new payload are queued');
    assert.deepEqual(remaining[0]!.payload, { n: 1 });
    assert.deepEqual(remaining[1]!.payload, { n: 2 });
    assert.ok('ts' in remaining[2]!.payload, 'third entry is the new payload, appended last');
    await fs.rm(dir, { recursive: true });
  });

  it('drops a fatal entry during flush and continues to the next one', async () => {
    const dir = await makeTmpDir();
    const queue = new ExportQueue(dir);
    queue.enqueue('t', { n: 1 });
    queue.enqueue('t', { n: 2 });
    const protocol = fakeProtocol([{ ok: false, retryable: false }, { ok: true }]);
    const exporter = new MetricExporterStub(protocol, fakeSerializer(), queue);

    await exporter.export(makeSnapshot());

    // entry 1 dropped (fatal), entry 2 flushed, then the new payload sent.
    assert.equal(protocol.calls.length, 3);
    assert.equal(queue.peekAll().length, 0);
    await fs.rm(dir, { recursive: true });
  });
});

// ── MetricPayloadSerializer ───────────────────────────────────────────────────

describe('MetricPayloadSerializer', () => {
  const serializer = new MetricPayloadSerializer();

  it('topic is "mallard/v3/metrics"', () => {
    assert.equal(serializer.topic, 'mallard/v3/metrics');
  });

  it('serialize returns an object with all expected metric keys', () => {
    const payload = serializer.serialize(makeSnapshot());
    const EXPECTED_KEYS = [
      'schema_version', 'instance_id', 'ts', 'tz_offset_minutes',
      'mtd_credits', 'mtd_cost_usd', 'today_credits', 'today_cost_usd',
      'mtd_budget_pct', 'forecast_basis', 'forecast_low', 'forecast_high',
      'budget_trend', 'daily_credit_stddev',
      'total_credits', 'total_tokens', 'total_event_count', 'estimated_event_count',
      'model_credits', 'surface_credits', 'cost_by_category',
      'active_models', 'top_model', 'model_count', 'repo_count',
      'source_connector',
    ];
    for (const key of EXPECTED_KEYS) {
      assert.ok(key in payload, `missing key: ${key}`);
    }
  });

  it('serialize returns a Record<string, unknown>', () => {
    const payload = serializer.serialize(makeSnapshot());
    assert.equal(typeof payload, 'object');
    assert.notEqual(payload, null);
  });

  it('schema_version is 3', () => {
    const payload = serializer.serialize(makeSnapshot());
    assert.equal(payload['schema_version'], 3);
  });

  it('cost_by_category is a record of string→number', () => {
    const payload = serializer.serialize(makeSnapshot());
    assert.equal(typeof payload['cost_by_category'], 'object');
    assert.notEqual(payload['cost_by_category'], null);
  });

  it('source_connector is "none" for a snapshot with no events', () => {
    const empty = buildSnapshot([], {
      now: Date.now(),
      currency: 'USD',
      pricePerCredit: 0.04,
      monthlyBudget: null,
      includedCredits: 300,
      filter: {},
      source: 'local',
      status: { kind: 'ok' },
      authStatus: 'signed-out',
    });
    const payload = serializer.serialize(empty);
    assert.equal(payload['source_connector'], 'none');
  });

  it('source_connector reflects the snapshot source when only one kind is present', () => {
    const payload = serializer.serialize(makeSnapshot());
    assert.ok(
      typeof payload['source_connector'] === 'string',
      'source_connector should be a string',
    );
    assert.notEqual(payload['source_connector'], 'mixed');
    assert.notEqual(payload['source_connector'], 'none');
  });

  it('event counts are exported raw — the server derives the estimated ratio', () => {
    const payload = serializer.serialize(makeSnapshot());
    assert.equal(typeof payload['total_event_count'], 'number');
    assert.equal(typeof payload['estimated_event_count'], 'number');
  });
});

// ── Real MetricExporter (flushQueue) + NullMetricExporter ─────────────────────

describe('MetricExporter (real class) — flushQueue', () => {
  it('flushQueue returns false when there is no queue', async () => {
    const exporter = new MetricExporter(fakeProtocol(), fakeSerializer());
    const stillDown = await (exporter as unknown as { flushQueue(): Promise<boolean> }).flushQueue();
    assert.equal(stillDown, false);
    exporter.dispose();
  });

  it('dequeues on ok and stops (enqueuing the new payload) on a retryable entry', async () => {
    const dir = await makeTmpDir();
    const queue = new ExportQueue(dir);
    queue.enqueue('t', { n: 1 });
    queue.enqueue('t', { n: 2 });
    const protocol = fakeProtocol([{ ok: true }, { ok: false, retryable: true }]);
    const exporter = new MetricExporter(protocol, fakeSerializer(), queue);
    await exporter.export(makeSnapshot());
    const remaining = queue.peekAll();
    assert.deepEqual(remaining[0]!.payload, { n: 2 }, 'first entry dequeued, second remains');
    assert.ok('ts' in remaining[remaining.length - 1]!.payload, 'new payload appended');
    exporter.dispose();
    await fs.rm(dir, { recursive: true });
  });

  it('drops a fatal entry and continues flushing', async () => {
    const dir = await makeTmpDir();
    const queue = new ExportQueue(dir);
    queue.enqueue('t', { n: 1 });
    const protocol = fakeProtocol([{ ok: false, retryable: false }]);
    const exporter = new MetricExporter(protocol, fakeSerializer(), queue);
    await exporter.export(makeSnapshot());
    assert.equal(queue.peekAll().length, 0, 'fatal entry dropped, new payload sent');
    exporter.dispose();
    await fs.rm(dir, { recursive: true });
  });

  it('stops flushing when disposed mid-flush', async () => {
    const dir = await makeTmpDir();
    const queue = new ExportQueue(dir);
    queue.enqueue('t', { n: 1 });
    const holder: { exporter?: MetricExporter } = {};
    const protocol: MetricProtocol = {
      async send() { holder.exporter?.dispose(); return { ok: true }; },
      dispose() {},
    };
    const exporter = new MetricExporter(protocol, fakeSerializer(), queue);
    holder.exporter = exporter;
    await exporter.export(makeSnapshot());
    assert.equal(queue.peekAll().length, 1, 'entry left intact when disposed mid-flush');
    await fs.rm(dir, { recursive: true });
  });
});

describe('NullMetricExporter', () => {
  it('export is a no-op through the null protocol and dispose is safe', async () => {
    const exporter = new NullMetricExporter();
    await exporter.export(makeSnapshot()); // exercises the null protocol send
    exporter.dispose();
  });
});
