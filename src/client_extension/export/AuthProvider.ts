import * as vscode from 'vscode';
import type { MallardConfig } from '../config';
import { createMetricExporter, createWebhookExporter } from './ExporterFactory';
import { NullMetricExporter, type MetricExporter } from './MetricExporter';
import { opt } from '../util/lang';

/**
 * Reads transport + auth config and builds the appropriate MetricExporter.
 * Password credentials are read from VS Code SecretStorage, never from settings.
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

    const cert = cfg.shared.certificate;

    if (transport === 'webhook') {
      const url = cfg.server.url;
      if (!url) return new NullMetricExporter();

      const headers: Record<string, string> = {};
      if (cfg.webhook.auth === 'apiKey' && cfg.webhook.apiKey) {
        headers['X-API-Key'] = cfg.webhook.apiKey;
      } else if (cfg.webhook.auth === 'bearer' && cfg.webhook.bearerToken) {
        headers['Authorization'] = `Bearer ${cfg.webhook.bearerToken}`;
      }

      return (
        createWebhookExporter({
          url,
          ...opt('headers', Object.keys(headers).length > 0 ? headers : undefined),
        }) ?? new NullMetricExporter()
      );
    }

    if (transport === 'mqtt') {
      const brokerUrl = cfg.mqtt.url || cfg.server.url;
      if (!brokerUrl) return new NullMetricExporter();

      const password = (await context.secrets.get('mallard.mqtt.password')) ?? '';
      const workspaceFolders = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath);

      return (
        createMetricExporter({
          brokerUrl,
          ...opt('username', cfg.mqtt.username || undefined),
          ...opt('password', password || undefined),
          ...opt('certPath', cert.file || undefined),
          ...opt('keyPath', cert.keyFile || undefined),
          ...opt('caPath', cert.caFile || undefined),
          ...(workspaceFolders?.length ? { workspaceFolders } : {}),
        }) ?? new NullMetricExporter()
      );
    }

    return new NullMetricExporter();
  }
}
