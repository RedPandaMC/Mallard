/**
 * Tests for the MetricExporter DI orchestrator pattern and VectorSerializer.
 *
 * MetricExporter.ts imports `vscode` (for MqttProtocol), so we cannot import
 * that file in the node unit-test runner. Instead:
 *   - The MetricExporter orchestrator is trivial (two lines); we test the DI
 *     contract with a local re-implementation using fakes.
 *   - VectorSerializer lives in vectorize.ts which has only a type-only import
 *     of MetricSerializer, so it is safe to import here.
 *
 * MqttProtocol and createMetricExporter (which both need vscode) are covered
 * by the integration test suite.
 */
import { strict as assert } from 'assert';
import { VectorSerializer } from '../../src/export/vectorize';
import { buildSnapshot } from '../../src/domain/snapshot';
import { makeEvent } from './helpers';
import type { MetricProtocol, MetricSerializer } from '../../src/export/MetricExporter';

// ── Minimal local re-implementation of MetricExporter (vscode-free) ──────────

class MetricExporterStub {
  private protocol: MetricProtocol;
  private serializer: MetricSerializer;
  constructor(protocol: MetricProtocol, serializer: MetricSerializer) {
    this.protocol = protocol;
    this.serializer = serializer;
  }
  export(snapshot: Parameters<MetricSerializer['serialize']>[0]): void {
    this.protocol.send(this.serializer.topic, this.serializer.serialize(snapshot));
  }
  dispose(): void { this.protocol.dispose(); }
}

// ── Fakes ─────────────────────────────────────────────────────────────────────

interface Call { topic: string; payload: Record<string, unknown> }

function fakeProtocol(): MetricProtocol & { calls: Call[]; disposed: boolean } {
  const calls: Call[] = [];
  let disposed = false;
  return {
    calls,
    get disposed() { return disposed; },
    send(topic, payload) { calls.push({ topic, payload }); },
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
  it('export() calls protocol.send with the serializer topic and payload', () => {
    const protocol = fakeProtocol();
    const serializer = fakeSerializer('my/topic');
    const exporter = new MetricExporterStub(protocol, serializer);

    exporter.export(makeSnapshot());

    assert.equal(protocol.calls.length, 1);
    assert.equal(protocol.calls[0]!.topic, 'my/topic');
    assert.ok('ts' in protocol.calls[0]!.payload);
  });

  it('export() invokes serializer.serialize', () => {
    const protocol = fakeProtocol();
    const serializer = fakeSerializer();
    const exporter = new MetricExporterStub(protocol, serializer);
    exporter.export(makeSnapshot());
    assert.equal(serializer.serializeCalled, true);
  });

  it('dispose() calls protocol.dispose', () => {
    const protocol = fakeProtocol();
    const exporter = new MetricExporterStub(protocol, fakeSerializer());
    exporter.dispose();
    assert.equal(protocol.disposed, true);
  });

  it('multiple exports accumulate in protocol calls', () => {
    const protocol = fakeProtocol();
    const exporter = new MetricExporterStub(protocol, fakeSerializer());
    const snap = makeSnapshot();
    exporter.export(snap);
    exporter.export(snap);
    assert.equal(protocol.calls.length, 2);
  });
});

// ── VectorSerializer ──────────────────────────────────────────────────────────

describe('VectorSerializer', () => {
  const serializer = new VectorSerializer();

  it('topic is "mallard/metrics"', () => {
    assert.equal(serializer.topic, 'mallard/metrics');
  });

  it('serialize returns an object with all 7 vector keys', () => {
    const payload = serializer.serialize(makeSnapshot());
    const EXPECTED_KEYS = [
      'ts', 'model_dist', 'surface_dist', 'input_cost_ratio',
      'credits_velocity_per_hour', 'mtd_budget_pct', 'repo_count',
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
});
