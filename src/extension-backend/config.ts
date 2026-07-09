import * as vscode from 'vscode';
import { PaletteMode } from './domain/types';

export interface MallardConfig {
  copilotLogPath: string;
  /** Optional override for Copilot's OTel export file / SQLite DB path. */
  copilotOtelPath: string;
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
  'mallard.copilotLogPath',
  'mallard.copilotOtelPath',
  'mallard.pricingManifestUrl',
  'mallard.palette',
  'mallard.refreshIntervalMinutes',
  'mallard.dataRetentionDays',
  'mallard.server.url',
  'mallard.export.transport',
  'mallard.webhook.auth',
  'mallard.mqtt.url',
  'mallard.mqtt.auth',
  'mallard.mqtt.username',
  'mallard.shared.certificate.file',
  'mallard.shared.certificate.keyFile',
  'mallard.shared.certificate.caFile',
];

export type CopilotOtelKind = 'ndjson' | 'sqlite' | 'none';

/** Where Copilot's local OTel export writes usage, resolved from settings. */
export interface CopilotOtelSource {
  kind: CopilotOtelKind;
  /** Absolute path to the JSONL file or SQLite DB; '' when kind is 'none'. */
  path: string;
}

/**
 * Resolve Copilot's local OTel export target. A Mallard override
 * (`mallard.copilotOtelPath`) wins; otherwise the file exporter's own
 * `github.copilot.chat.otel.outfile` is used when the exporter is enabled.
 * A `.sqlite`/`.db` path selects the SQLite source; anything else is NDJSON.
 */
export function readCopilotOtel(): CopilotOtelSource {
  const copilot = vscode.workspace.getConfiguration('github.copilot.chat');
  const exporterType = String(copilot.get('otel.exporterType', '') ?? '');
  const outfile = String(copilot.get('otel.outfile', '') ?? '');
  const override = String(vscode.workspace.getConfiguration('mallard').get('copilotOtelPath', '') ?? '');
  const resolved = override || (exporterType === 'file' ? outfile : '');
  if (!resolved) return { kind: 'none', path: '' };
  const kind: CopilotOtelKind = /\.(sqlite|db)$/i.test(resolved) ? 'sqlite' : 'ndjson';
  return { kind, path: resolved };
}

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
    copilotLogPath: c.get('copilotLogPath', ''),
    copilotOtelPath: c.get('copilotOtelPath', ''),
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
