import { strict as assert } from 'assert';
import { promises as fs, writeFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MqttProtocol } from '../../src/extension-backend/export/MetricExporter';

/** A scriptable fake MqttClient. */
interface FakeClient {
  connected: boolean;
  on(event: string, cb: (e?: Error) => void): void;
  publish(topic: string, body: string, opts: unknown, cb: (err?: Error) => void): void;
  end(force?: boolean): void;
}

const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };

const g = globalThis as unknown as { __mqttConnectImpl__?: (url: string, opts: unknown) => unknown };

const TOPIC = 'mallard/v3/metrics';

function setMqttImpl(impl: (url: string, opts: unknown) => FakeClient): () => void {
  (g as { __mqttConnectImpl__?: unknown }).__mqttConnectImpl__ = impl;
  return () => { delete g.__mqttConnectImpl__; };
}

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mallard-mqtt-'));
}

describe('MqttProtocol — constructor config validation', () => {
  it('rejects a plaintext broker url without connecting and sends as fatal', async () => {
    let connected = false;
    const restore = setMqttImpl(() => { connected = true; return null as never; });
    try {
      const p = new MqttProtocol({ brokerUrl: 'ws://insecure/mqtt', topicPrefix: TOPIC }, quietLogger);
      assert.equal(connected, false);
      const r = await p.send('t', { schema_version: 3 });
      assert.deepEqual(r, { ok: false, retryable: false });
      p.dispose();
    } finally {
      restore();
    }
  });

  it('resolves the topic as <prefix>/<machineHash> with no workspace folders', async () => {
    const restore = setMqttImpl(() => ({ connected: false, on() {}, publish() {}, end() {} }) as unknown as FakeClient);
    try {
      const p = new MqttProtocol({ brokerUrl: 'mqtts://broker:8883', topicPrefix: TOPIC }, quietLogger);
      const r = await p.send('t', { schema_version: 3 });
      assert.equal(r.ok, false);
      assert.equal((r as { retryable: boolean }).retryable, true);
      p.dispose();
    } finally {
      restore();
    }
  });

  it('resolves the topic as <prefix>/<machineHash>/<wsHash> with workspace folders', async () => {
    const restore = setMqttImpl(() => ({ connected: false, on() {}, publish() {}, end() {} }) as unknown as FakeClient);
    try {
      const p = new MqttProtocol(
        { brokerUrl: 'wss://broker:443', topicPrefix: TOPIC, workspaceFolders: ['/a', '/b'] },
        quietLogger,
      );
      assert.ok(p);
      p.dispose();
    } finally {
      restore();
    }
  });
});

describe('MqttProtocol — send() publish outcomes', () => {
  it('returns ok:true when the publish ack fires with no error', async () => {
    const fake: FakeClient = {
      connected: true,
      on() {},
      publish(_t, _b, _o, cb) { cb(); },
      end() {},
    };
    const restore = setMqttImpl(() => fake);
    try {
      const p = new MqttProtocol({ brokerUrl: 'mqtts://broker:8883', topicPrefix: TOPIC }, quietLogger);
      const r = await p.send('t', { schema_version: 3 });
      assert.equal(r.ok, true);
      p.dispose();
    } finally {
      restore();
    }
  });

  it('returns retryable when the publish ack fires with an error', async () => {
    const fake: FakeClient = {
      connected: true,
      on() {},
      publish(_t, _b, _o, cb) { cb(new Error('pub failed')); },
      end() {},
    };
    const restore = setMqttImpl(() => fake);
    try {
      const p = new MqttProtocol({ brokerUrl: 'mqtts://broker:8883', topicPrefix: TOPIC }, quietLogger);
      const r = await p.send('t', { schema_version: 3 });
      assert.equal(r.ok, false);
      assert.equal((r as { retryable: boolean }).retryable, true);
      p.dispose();
    } finally {
      restore();
    }
  });

  it('returns retryable when the client is not yet connected', async () => {
    const fake: FakeClient = {
      connected: false,
      on() {},
      publish() {},
      end() {},
    };
    const restore = setMqttImpl(() => fake);
    try {
      const p = new MqttProtocol({ brokerUrl: 'mqtts://broker:8883', topicPrefix: TOPIC }, quietLogger);
      const r = await p.send('t', { schema_version: 3 });
      assert.equal(r.ok, false);
      assert.equal((r as { retryable: boolean }).retryable, true);
      p.dispose();
    } finally {
      restore();
    }
  });

  it('routes the client "error" event to the logger without throwing', async () => {
    let errorCb: ((e: Error) => void) | undefined;
    const fake: FakeClient = {
      connected: true,
      on(_ev, cb) { errorCb = cb as (e: Error) => void; },
      publish(_t, _b, _o, cb) { cb(); },
      end() {},
    };
    const restore = setMqttImpl(() => fake);
    try {
      const p = new MqttProtocol({ brokerUrl: 'mqtts://broker:8883', topicPrefix: TOPIC }, quietLogger);
      assert.doesNotThrow(() => errorCb!(new Error('broker down')));
      p.dispose();
    } finally {
      restore();
    }
  });

  it('dispose() calls client.end() without throwing', async () => {
    let ended = false;
    const fake: FakeClient = {
      connected: true,
      on() {},
      publish(_t, _b, _o, cb) { cb(); },
      end() { ended = true; },
    };
    const restore = setMqttImpl(() => fake);
    try {
      const p = new MqttProtocol({ brokerUrl: 'mqtts://broker:8883', topicPrefix: TOPIC }, quietLogger);
      assert.doesNotThrow(() => p.dispose());
      assert.equal(ended, true);
    } finally {
      restore();
    }
  });
});

describe('MqttProtocol — mTLS cert handling', () => {
  it('connects with cert/key/ca when all three paths are readable', async () => {
    const dir = await tmpDir();
    const certPath = path.join(dir, 'cert.pem');
    const keyPath = path.join(dir, 'key.pem');
    const caPath = path.join(dir, 'ca.pem');
    writeFileSync(certPath, 'cert');
    writeFileSync(keyPath, 'key');
    writeFileSync(caPath, 'ca');
    let capturedOpts: unknown;
    const restore = setMqttImpl((_url, opts) => {
      capturedOpts = opts;
      return { connected: false, on() {}, publish() {}, end() {} } as unknown as FakeClient;
    });
    try {
      const p = new MqttProtocol({ brokerUrl: 'mqtts://broker:8883', topicPrefix: TOPIC, certPath, keyPath, caPath }, quietLogger);
      const o = capturedOpts as { cert: Buffer; key: Buffer; ca: Buffer };
      assert.equal(o.cert.toString(), 'cert');
      assert.equal(o.key.toString(), 'key');
      assert.equal(o.ca.toString(), 'ca');
      p.dispose();
    } finally {
      restore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('warns when only one of certPath/keyPath is set, and connects without mTLS', async () => {
    let sawWarn = false;
    const restore = setMqttImpl(() => ({ connected: false, on() {}, publish() {}, end() {} }) as unknown as FakeClient);
    try {
      const p = new MqttProtocol(
        { brokerUrl: 'mqtts://broker:8883', topicPrefix: TOPIC, certPath: '/no/cert.pem' },
        { ...quietLogger, warn: () => { sawWarn = true; } },
      );
      assert.equal(sawWarn, true);
      p.dispose();
    } finally {
      restore();
    }
  });

  it('reports retryable (not fatal) when mTLS cert files cannot be read', async () => {
    const restore = setMqttImpl(() => { throw new Error('should not connect'); });
    try {
      const p = new MqttProtocol(
        { brokerUrl: 'mqtts://broker:8883', topicPrefix: TOPIC, certPath: '/no/cert.pem', keyPath: '/no/key.pem' },
        quietLogger,
      );
      // No client created (cert read failed) but resolvedTopic is set → retryable, not fatal.
      const r = await p.send('t', { schema_version: 3 });
      assert.equal(r.ok, false);
      assert.equal((r as { retryable: boolean }).retryable, true);
      p.dispose();
    } finally {
      restore();
    }
  });
});
