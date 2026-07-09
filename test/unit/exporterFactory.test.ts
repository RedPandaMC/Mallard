import { strict as assert } from 'assert';
import {
  createMetricExporter,
  createMqttProtocol,
  createWebhookExporter,
  createWebhookProtocol,
} from '../../src/extension-backend/export/ExporterFactory';
import { MetricExporter } from '../../src/extension-backend/export/MetricExporter';

describe('ExporterFactory', () => {
  it('createWebhookProtocol returns null without a url', () => {
    assert.equal(createWebhookProtocol({}), null);
    assert.equal(createWebhookProtocol({ url: '' }), null);
  });

  it('createWebhookProtocol builds a protocol for an https url', () => {
    const protocol = createWebhookProtocol({ url: 'https://example.com/ingest' });
    assert.ok(protocol);
    protocol!.dispose();
  });

  it('createWebhookExporter wraps the protocol in a MetricExporter', () => {
    const exporter = createWebhookExporter({ url: 'https://example.com/ingest' });
    assert.ok(exporter instanceof MetricExporter);
    exporter!.dispose();
    assert.equal(createWebhookExporter({}), null);
  });

  it('createMqttProtocol returns null without a broker url', () => {
    assert.equal(createMqttProtocol({}), null);
    assert.equal(createMetricExporter({}), null);
  });

  it('createMqttProtocol refuses a plaintext broker url without connecting', async () => {
    // ws:// (no TLS) is rejected in the constructor — no client is created,
    // and send() reports a non-retryable failure.
    const protocol = createMqttProtocol({ brokerUrl: 'ws://insecure.example/mqtt' });
    assert.ok(protocol);
    const result = await protocol!.send('t', { schema_version: 3 });
    assert.deepEqual(result, { ok: false, retryable: false });
    protocol!.dispose();
  });

  it('createMqttProtocol builds a protocol with every optional field set', () => {
    const protocol = createMqttProtocol({
      brokerUrl: 'wss://broker.example/mqtt',
      topic: 'custom/topic',
      username: 'u',
      password: 'p',
      certPath: '/tmp/cert.pem',
      keyPath: '/tmp/key.pem',
      caPath: '/tmp/ca.pem',
      workspaceFolders: ['/w1', '/w2'],
    });
    assert.ok(protocol);
    protocol!.dispose();
  });

  it('createMqttProtocol/createMetricExporter return null without a broker url', () => {
    assert.equal(createMqttProtocol({}), null);
    assert.equal(createMetricExporter({}), null);
  });

  it('createMetricExporter wraps a minimal MQTT protocol (default topic prefix)', () => {
    const exporter = createMetricExporter({ brokerUrl: 'wss://broker.example/mqtt' });
    assert.ok(exporter instanceof MetricExporter);
    exporter!.dispose();
  });

  it('createWebhookProtocol builds a protocol with every optional field set', () => {
    const protocol = createWebhookProtocol({
      url: 'https://example.com/ingest',
      secret: 's3',
      headers: { 'X-Extra': '1' },
      retries: 2,
      certFile: '/tmp/cert.pem',
      keyFile: '/tmp/key.pem',
      caFile: '/tmp/ca.pem',
    });
    assert.ok(protocol);
    protocol!.dispose();
  });
});
