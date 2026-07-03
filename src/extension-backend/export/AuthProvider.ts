import * as vscode from 'vscode';
import type { MallardConfig } from '../config';
import { SECRET_KEYS } from '../app/credentials';
import { createMetricExporter, createWebhookExporter } from './ExporterFactory';
import { NullMetricExporter, type MetricExporter } from './MetricExporter';
import { ExportQueue } from './ExportQueue';
import { opt } from '../util/lang';

/**
 * Reads transport + auth config and builds the appropriate MetricExporter.
 * Credentials come from VS Code SecretStorage; the deprecated plaintext
 * settings are honoured as a fallback until the one-time migration has run.
 */
export class AuthProvider {
  constructor(
    private readonly cfg: MallardConfig,
    private readonly context: vscode.ExtensionContext,
  ) {}

  async createExporter(): Promise<MetricExporter> {
    const { cfg, context } = this;
    const transport = cfg.export.transport;

    if (!transport) return new NullMetricExporter();

    const queue = new ExportQueue(context.globalStorageUri.fsPath);
    const cert = cfg.shared.certificate;

    if (transport === 'webhook') {
      const url = cfg.server.url;
      if (!url) return new NullMetricExporter();

      const apiKey =
        (await context.secrets.get(SECRET_KEYS.webhookApiKey)) || cfg.webhook.apiKey;
      const bearerToken =
        (await context.secrets.get(SECRET_KEYS.webhookBearerToken)) || cfg.webhook.bearerToken;
      // Optional HMAC request signing (X-Mallard-Signature-256). Set via
      // "Mallard: Set Webhook Signing Secret"; must match the server's
      // WEBHOOK_HMAC_SECRETS entry.
      const signingSecret = await context.secrets.get(SECRET_KEYS.webhookSigningSecret);

      const headers: Record<string, string> = {};
      if (cfg.webhook.auth === 'apiKey' && apiKey) {
        headers['X-API-Key'] = apiKey;
      } else if (cfg.webhook.auth === 'bearer' && bearerToken) {
        headers['Authorization'] = `Bearer ${bearerToken}`;
      }

      const certOpts =
        cfg.webhook.auth === 'certificate'
          ? {
              ...opt('certFile', cert.file || undefined),
              ...opt('keyFile', cert.keyFile || undefined),
              ...opt('caFile', cert.caFile || undefined),
            }
          : {};

      return (
        createWebhookExporter(
          {
            url,
            ...opt('secret', signingSecret || undefined),
            ...opt('headers', Object.keys(headers).length > 0 ? headers : undefined),
            ...certOpts,
          },
          queue,
        ) ?? new NullMetricExporter()
      );
    }

    if (transport === 'mqtt') {
      const brokerUrl = cfg.mqtt.url || cfg.server.url;
      if (!brokerUrl) return new NullMetricExporter();

      const password = (await context.secrets.get(SECRET_KEYS.mqttPassword)) ?? '';
      const workspaceFolders = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath);

      return (
        createMetricExporter(
          {
            brokerUrl,
            ...opt('username', cfg.mqtt.username || undefined),
            ...opt('password', password || undefined),
            ...opt('certPath', cert.file || undefined),
            ...opt('keyPath', cert.keyFile || undefined),
            ...opt('caPath', cert.caFile || undefined),
            ...(workspaceFolders?.length ? { workspaceFolders } : {}),
          },
          queue,
        ) ?? new NullMetricExporter()
      );
    }

    return new NullMetricExporter();
  }
}
