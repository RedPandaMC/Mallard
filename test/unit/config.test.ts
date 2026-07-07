import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import { readConfig, readCopilotOtel, RELEVANT_CONFIG_KEYS } from '../../src/extension-backend/config';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const ws = vscode.workspace as Mutable<typeof vscode.workspace>;

function withSettings(values: Record<string, unknown>) {
  ws.getConfiguration = (() => ({
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
    update: () => Promise.resolve(),
  })) as unknown as typeof ws.getConfiguration;
}

describe('readConfig', () => {
  const originalGetConfiguration = ws.getConfiguration;
  afterEach(() => { ws.getConfiguration = originalGetConfiguration; });

  it('returns documented defaults when nothing is configured', () => {
    withSettings({});
    const cfg = readConfig();
    assert.equal(cfg.copilotLogPath, '');
    assert.equal(cfg.palette, 'swiss');
    assert.equal(cfg.refreshIntervalMinutes, 10);
    assert.equal(cfg.dataRetentionDays, 90);
    assert.equal(cfg.export.transport, '');
    assert.equal(cfg.webhook.auth, 'apiKey');
    assert.equal(cfg.mqtt.auth, 'password');
    assert.deepEqual(cfg.shared.certificate, { file: '', keyFile: '', caFile: '' });
  });

  it('clamps refreshIntervalMinutes to [1, 60] and dataRetentionDays to [30, 365]', () => {
    withSettings({ refreshIntervalMinutes: 0, dataRetentionDays: 5 });
    let cfg = readConfig();
    assert.equal(cfg.refreshIntervalMinutes, 1);
    assert.equal(cfg.dataRetentionDays, 30);

    withSettings({ refreshIntervalMinutes: 999, dataRetentionDays: 9999 });
    cfg = readConfig();
    assert.equal(cfg.refreshIntervalMinutes, 60);
    assert.equal(cfg.dataRetentionDays, 365);
  });

  it('narrows export.transport to the known values', () => {
    withSettings({ 'export.transport': 'webhook' });
    assert.equal(readConfig().export.transport, 'webhook');
    withSettings({ 'export.transport': 'mqtt' });
    assert.equal(readConfig().export.transport, 'mqtt');
    withSettings({ 'export.transport': 'carrier-pigeon' });
    assert.equal(readConfig().export.transport, '');
  });

  it('narrows webhook.auth and mqtt.auth, defaulting unknown values', () => {
    withSettings({ 'webhook.auth': 'bearer', 'mqtt.auth': 'certificate' });
    let cfg = readConfig();
    assert.equal(cfg.webhook.auth, 'bearer');
    assert.equal(cfg.mqtt.auth, 'certificate');

    withSettings({ 'webhook.auth': 'certificate' });
    assert.equal(readConfig().webhook.auth, 'certificate');

    withSettings({ 'webhook.auth': 'magic', 'mqtt.auth': 'magic' });
    cfg = readConfig();
    assert.equal(cfg.webhook.auth, 'apiKey');
    assert.equal(cfg.mqtt.auth, 'password');
  });

  it('trims server and mqtt URLs', () => {
    withSettings({ 'server.url': ' https://mallard.example.com ', 'mqtt.url': ' wss://b/mqtt ' });
    const cfg = readConfig();
    assert.equal(cfg.server.url, 'https://mallard.example.com');
    assert.equal(cfg.mqtt.url, 'wss://b/mqtt');
  });

  it('RELEVANT_CONFIG_KEYS lists every setting readConfig consumes', () => {
    // Guard against drift: each key read above must be watched for changes.
    for (const key of [
      'mallard.copilotLogPath', 'mallard.refreshIntervalMinutes',
      'mallard.dataRetentionDays', 'mallard.server.url', 'mallard.export.transport',
      'mallard.webhook.auth', 'mallard.mqtt.url', 'mallard.mqtt.auth', 'mallard.mqtt.username',
      'mallard.shared.certificate.file', 'mallard.shared.certificate.keyFile',
      'mallard.shared.certificate.caFile',
    ]) {
      assert.ok(RELEVANT_CONFIG_KEYS.includes(key), `${key} missing from RELEVANT_CONFIG_KEYS`);
    }
  });
});

describe('readCopilotOtel', () => {
  const originalGetConfiguration = ws.getConfiguration;
  afterEach(() => { ws.getConfiguration = originalGetConfiguration; });

  function withOtel(copilot: Record<string, unknown>, mallard: Record<string, unknown> = {}) {
    ws.getConfiguration = ((section: string) => ({
      get: (key: string, fallback?: unknown) => {
        const src = section === 'mallard' ? mallard : copilot;
        return key in src ? src[key] : fallback;
      },
      update: () => Promise.resolve(),
    })) as unknown as typeof ws.getConfiguration;
  }

  it('returns none when nothing is configured', () => {
    withOtel({});
    assert.deepEqual(readCopilotOtel(), { kind: 'none', path: '' });
  });

  it('returns ndjson for the file exporter outfile', () => {
    withOtel({ 'otel.exporterType': 'file', 'otel.outfile': '/x/copilot.jsonl' });
    assert.deepEqual(readCopilotOtel(), { kind: 'ndjson', path: '/x/copilot.jsonl' });
  });

  it('ignores the outfile when the exporter is not the file exporter', () => {
    withOtel({ 'otel.exporterType': 'otlp-http', 'otel.outfile': '/x/copilot.jsonl' });
    assert.deepEqual(readCopilotOtel(), { kind: 'none', path: '' });
  });

  it('lets the Mallard override win and infers sqlite from a .sqlite/.db path', () => {
    withOtel({ 'otel.exporterType': 'file', 'otel.outfile': '/x/a.jsonl' }, { copilotOtelPath: '/y/spans.sqlite' });
    assert.deepEqual(readCopilotOtel(), { kind: 'sqlite', path: '/y/spans.sqlite' });
    withOtel({}, { copilotOtelPath: '/y/data.db' });
    assert.equal(readCopilotOtel().kind, 'sqlite');
    withOtel({}, { copilotOtelPath: '/y/spans.log' });
    assert.equal(readCopilotOtel().kind, 'ndjson');
  });
});
