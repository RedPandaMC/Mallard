import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import { readConfig, RELEVANT_CONFIG_KEYS } from '../../src/extension-backend/config';

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
    assert.equal(cfg.currency, 'USD');
    assert.equal(cfg.copilotLogPath, '');
    assert.equal(cfg.palette, 'swiss');
    assert.equal(cfg.refreshIntervalMinutes, 10);
    assert.equal(cfg.dataRetentionDays, 90);
    assert.equal(cfg.export.transport, '');
    assert.equal(cfg.webhook.auth, 'apiKey');
    assert.equal(cfg.mqtt.auth, 'password');
    assert.deepEqual(cfg.shared.certificate, { file: '', keyFile: '', caFile: '' });
  });

  it('normalises the currency (trim + uppercase, empty falls back to USD)', () => {
    withSettings({ currency: '  eur ' });
    assert.equal(readConfig().currency, 'EUR');
    withSettings({ currency: '   ' });
    assert.equal(readConfig().currency, 'USD');
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
      'mallard.currency', 'mallard.copilotLogPath', 'mallard.refreshIntervalMinutes',
      'mallard.dataRetentionDays', 'mallard.server.url', 'mallard.export.transport',
      'mallard.webhook.auth', 'mallard.mqtt.url', 'mallard.mqtt.auth', 'mallard.mqtt.username',
      'mallard.shared.certificate.file', 'mallard.shared.certificate.keyFile',
      'mallard.shared.certificate.caFile',
    ]) {
      assert.ok(RELEVANT_CONFIG_KEYS.includes(key), `${key} missing from RELEVANT_CONFIG_KEYS`);
    }
  });
});
