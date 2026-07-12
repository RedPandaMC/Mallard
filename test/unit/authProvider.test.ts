import { strict as assert } from 'assert';
import { AuthProvider } from '../../src/extension-backend/export/AuthProvider';
import {
  FanoutMetricExporter,
  MetricExporter,
  NullMetricExporter,
} from '../../src/extension-backend/export/MetricExporter';
import { SECRET_KEYS } from '../../src/extension-backend/app/credentials';
import type { MallardConfig } from '../../src/extension-backend/config';
import type { ExportConfig } from '../../src/extension-backend/domain/types';
import type * as vscode from 'vscode';

function makeConfig(over: {
  transport?: MallardConfig['export']['transport'];
  serverUrl?: string;
  webhookAuth?: MallardConfig['webhook']['auth'];
  mqttUrl?: string;
} = {}): MallardConfig {
  return {
    copilotLogPath: '',
    copilotOtelPath: '',
    pricingManifestUrl: '',
    palette: 'swiss',
    refreshIntervalMinutes: 10,
    dataRetentionDays: 90,
    server: { url: over.serverUrl ?? '' },
    export: { transport: over.transport ?? '' },
    webhook: { auth: over.webhookAuth ?? 'apiKey' },
    mqtt: { url: over.mqttUrl ?? '', auth: 'password', username: '' },
    shared: { certificate: { file: '', keyFile: '', caFile: '' } },
  };
}

/** Fake ExtensionContext exposing only what AuthProvider touches; records
 *  every SecretStorage key requested so namespacing is assertable. */
function makeContext(secretValues: Record<string, string> = {}) {
  const requested: string[] = [];
  return {
    requested,
    context: {
      globalStorageUri: { fsPath: '/tmp/mallard-authprovider-test' },
      secrets: {
        get: async (key: string) => {
          requested.push(key);
          return secretValues[key];
        },
      },
    } as unknown as vscode.ExtensionContext,
  };
}

describe('AuthProvider.createExporter', () => {
  it('returns a NullMetricExporter when no transport is configured', async () => {
    const { context } = makeContext();
    const exporter = await new AuthProvider(makeConfig(), context).createExporter();
    assert.ok(exporter instanceof NullMetricExporter);
  });

  it('returns a NullMetricExporter when the transport has no usable URL', async () => {
    const { context } = makeContext();
    const exporter = await new AuthProvider(
      makeConfig({ transport: 'webhook', serverUrl: '' }),
      context,
    ).createExporter();
    assert.ok(exporter instanceof NullMetricExporter);
  });

  it('builds a single webhook MetricExporter and reads only base secret slots', async () => {
    const { context, requested } = makeContext({ [SECRET_KEYS.webhookApiKey]: 'key-1' });
    const exporter = await new AuthProvider(
      makeConfig({ transport: 'webhook', serverUrl: 'https://mallard.example.com' }),
      context,
    ).createExporter();
    assert.ok(exporter instanceof MetricExporter, 'single target → plain MetricExporter');
    assert.ok(!(exporter instanceof FanoutMetricExporter));
    assert.ok(requested.includes(SECRET_KEYS.webhookApiKey));
    assert.ok(requested.includes(SECRET_KEYS.webhookBearerToken));
    assert.ok(requested.includes(SECRET_KEYS.webhookSigningSecret));
    assert.ok(
      requested.every((k) => !k.includes(':')),
      `no per-target keys without targets, got ${requested.join(', ')}`,
    );
    exporter.dispose();
  });

  it('fans out to config.json webhook targets with per-target secret namespacing', async () => {
    const { context, requested } = makeContext({
      [SECRET_KEYS.webhookApiKey]: 'primary-key',
      [`${SECRET_KEYS.webhookApiKey}:team`]: 'team-key',
    });
    const exportCfg: ExportConfig = {
      webhookTargets: [{ name: 'team', url: 'https://mallard.team.example.com' }],
    };
    const exporter = await new AuthProvider(
      makeConfig({ transport: 'webhook', serverUrl: 'https://mallard.example.com' }),
      context,
      exportCfg,
    ).createExporter();
    assert.ok(exporter instanceof FanoutMetricExporter, 'primary + target → fanout');
    assert.ok(requested.includes(`${SECRET_KEYS.webhookApiKey}:team`), 'target key namespaced by name');
    assert.ok(requested.includes(`${SECRET_KEYS.webhookBearerToken}:team`));
    assert.ok(requested.includes(`${SECRET_KEYS.webhookSigningSecret}:team`));
    exporter.dispose();
  });

  it('builds an MQTT exporter from mqtt.url and reads the broker password slot', async () => {
    const { context, requested } = makeContext({ [SECRET_KEYS.mqttPassword]: 'pw' });
    const exporter = await new AuthProvider(
      makeConfig({ transport: 'mqtt', mqttUrl: 'wss://mallard.example.com/mqtt' }),
      context,
    ).createExporter();
    assert.ok(exporter instanceof MetricExporter);
    assert.ok(requested.includes(SECRET_KEYS.mqttPassword));
    exporter.dispose();
  });

  it('namespaces per-broker passwords for mqtt fanout targets', async () => {
    const { context, requested } = makeContext();
    const exportCfg: ExportConfig = {
      mqttTargets: [{ name: 'team-broker', url: 'wss://team.example.com/mqtt' }],
    };
    const exporter = await new AuthProvider(
      makeConfig({ transport: 'mqtt', mqttUrl: 'wss://mallard.example.com/mqtt' }),
      context,
      exportCfg,
    ).createExporter();
    assert.ok(exporter instanceof FanoutMetricExporter);
    assert.ok(requested.includes(`${SECRET_KEYS.mqttPassword}:team-broker`));
    exporter.dispose();
  });
});
