import * as vscode from 'vscode';
import { PaletteMode } from './domain/types';

export interface MallardConfig {
  currency: string;
  copilotLogPath: string;
  pricingManifestUrl: string;
  palette: PaletteMode;
  /** Minutes between automatic log re-reads and snapshot refreshes. Default 10. */
  refreshIntervalMinutes: number;
  /** Days of raw per-request events to retain before rolling up. Default 90. */
  dataRetentionDays: number;
  server: {
    url: string;
  };
  export: {
    transport: 'webhook' | 'mqtt' | '';
  };
  webhook: {
    auth: 'apiKey' | 'bearer' | 'certificate';
    apiKey: string;
    bearerToken: string;
  };
  mqtt: {
    url: string;
    auth: 'password' | 'certificate';
    username: string;
  };
  shared: {
    certificate: {
      file: string;
      keyFile: string;
      caFile: string;
    };
  };
}

export const RELEVANT_CONFIG_KEYS = [
  'mallard.currency',
  'mallard.copilotLogPath',
  'mallard.pricingManifestUrl',
  'mallard.palette',
  'mallard.refreshIntervalMinutes',
  'mallard.dataRetentionDays',
  'mallard.server.url',
  'mallard.export.transport',
  'mallard.webhook.auth',
  'mallard.webhook.apiKey',
  'mallard.webhook.bearerToken',
  'mallard.mqtt.url',
  'mallard.mqtt.auth',
  'mallard.mqtt.username',
  'mallard.shared.certificate.file',
  'mallard.shared.certificate.keyFile',
  'mallard.shared.certificate.caFile',
];

export function readConfig(): MallardConfig {
  const c = vscode.workspace.getConfiguration('mallard');

  const rawTransport = c.get<string>('export.transport', '');
  const transport: MallardConfig['export']['transport'] =
    rawTransport === 'webhook' ? 'webhook' : rawTransport === 'mqtt' ? 'mqtt' : '';

  const rawWebhookAuth = c.get<string>('webhook.auth', 'apiKey');
  const webhookAuth: MallardConfig['webhook']['auth'] =
    rawWebhookAuth === 'bearer'
      ? 'bearer'
      : rawWebhookAuth === 'certificate'
        ? 'certificate'
        : 'apiKey';

  const rawMqttAuth = c.get<string>('mqtt.auth', 'password');
  const mqttAuth: MallardConfig['mqtt']['auth'] =
    rawMqttAuth === 'certificate' ? 'certificate' : 'password';

  return {
    currency: c.get<string>('currency', 'USD').trim().toUpperCase() || 'USD',
    copilotLogPath: c.get('copilotLogPath', ''),
    pricingManifestUrl: c.get('pricingManifestUrl', ''),
    palette: c.get<string>('palette', 'swiss') === 'theme' ? 'theme' : 'swiss',
    refreshIntervalMinutes: Math.max(1, Math.min(60, c.get('refreshIntervalMinutes', 10))),
    dataRetentionDays: Math.max(30, Math.min(365, c.get('dataRetentionDays', 90))),
    server: {
      url: c.get<string>('server.url', '').trim(),
    },
    export: { transport },
    webhook: {
      auth: webhookAuth,
      apiKey: c.get<string>('webhook.apiKey', ''),
      bearerToken: c.get<string>('webhook.bearerToken', ''),
    },
    mqtt: {
      url: c.get<string>('mqtt.url', '').trim(),
      auth: mqttAuth,
      username: c.get<string>('mqtt.username', ''),
    },
    shared: {
      certificate: {
        file: c.get<string>('shared.certificate.file', ''),
        keyFile: c.get<string>('shared.certificate.keyFile', ''),
        caFile: c.get<string>('shared.certificate.caFile', ''),
      },
    },
  };
}
