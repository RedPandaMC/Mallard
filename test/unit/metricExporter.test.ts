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
import { buildStreamBatch, StreamBatchSerializer } from '../../src/extension-backend/export/payload';
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
    serialize(batch) {
      serializeCalled = true;
      return { ts: new Date(batch.sent_at).toISOString() };
    },
  };
}

function makeSnapshot() {
  return buildStreamBatch([
    makeEvent({ ts: Date.now() - 1000, modelId: 'gpt-4o', credits: 5, language: 'typescript' }),
  ]);
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

describe('MetricExporter — concurrent export during a flush', () => {
  it('queues (never drops) a batch that arrives while a flush is in flight', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mallard-flushing-'));
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const calls: string[] = [];
    const protocol: MetricProtocol = {
      async send(_topic, payload) {
        calls.push(JSON.stringify(payload));
        await gate; // hold the first send open
        return { ok: true };
      },
      dispose() {},
    };
    const queue = new ExportQueue(dir, 'concurrent.json');
    const serializer: MetricSerializer = { topic: 't', serialize: (b) => ({ n: b.sent_at }) };
    const exporter = new MetricExporter(protocol, serializer, queue);

    const first = exporter.export({ ...makeSnapshot(), sent_at: 1 });
    // Second batch lands mid-flight: must be enqueued, not dropped.
    await exporter.export({ ...makeSnapshot(), sent_at: 2 });
    assert.equal(queue.peekAll().length, 1);
    assert.deepEqual(queue.peekAll()[0]!.payload, { n: 2 });

    release();
    await first;
    // The next export flushes the queued batch first, preserving order.
    await exporter.export({ ...makeSnapshot(), sent_at: 3 });
    assert.deepEqual(calls.map((c) => JSON.parse(c).n), [1, 2, 3]);
    assert.equal(queue.peekAll().length, 0);
    exporter.dispose();
  });
});

describe('MetricExporter — concurrent export without a queue', () => {
  it('drops the mid-flush batch harmlessly when no durable queue exists', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const protocol: MetricProtocol = {
      async send() { await gate; return { ok: true }; },
      dispose() {},
    };
    const serializer: MetricSerializer = { topic: 't', serialize: (b) => ({ n: b.sent_at }) };
    const exporter = new MetricExporter(protocol, serializer);
    const first = exporter.export(makeSnapshot());
    await assert.doesNotReject(exporter.export(makeSnapshot()));
    release();
    await first;
    exporter.dispose();
  });
});

describe('StreamBatchSerializer', () => {
  const serializer = new StreamBatchSerializer();

  it('topic is "events"', () => {
    assert.equal(serializer.topic, 'events');
  });

  it('serialize passes the v1 batch through with its events', () => {
    const payload = serializer.serialize(makeSnapshot());
    assert.equal(payload['schema_version'], 1);
    assert.equal(typeof payload['instance_id'], 'string');
    assert.equal(typeof payload['sent_at'], 'number');
    const events = payload['events'] as Array<Record<string, unknown>>;
    assert.equal(events.length, 1);
    assert.equal(events[0]!['model'], 'gpt-4o');
    assert.equal(events[0]!['credits'], 5);
    assert.equal(events[0]!['language'], 'typescript');
    assert.equal(events[0]!['connector'], 'local');

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

  it('a retryable failure on the fresh send enqueues the payload (no backlog to flush)', async () => {
    const dir = await makeTmpDir();
    const queue = new ExportQueue(dir);
    const protocol = fakeProtocol([{ ok: false, retryable: true }]);
    const exporter = new MetricExporter(protocol, fakeSerializer(), queue);
    await exporter.export(makeSnapshot());
    assert.equal(queue.peekAll().length, 1, 'fresh send queued after a retryable failure');
    exporter.dispose();
    await fs.rm(dir, { recursive: true });
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
