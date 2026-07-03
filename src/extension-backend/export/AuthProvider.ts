import * as vscode from 'vscode';
import type { MallardConfig } from '../config';
import type { WebhookTarget } from '../domain/types';
import { SECRET_KEYS, targetSecretKey } from '../app/credentials';
import {
  createMetricExporter,
  createWebhookProtocol,
  FanoutProtocol,
} from './ExporterFactory';
import {
  MetricExporter,
  NullMetricExporter,
  type MetricProtocol,
} from './MetricExporter';
import { MetricPayloadSerializer } from './payload';
import { ExportQueue } from './ExportQueue';
import { opt } from '../util/lang';

/**
 * Reads transport + auth config and builds the appropriate MetricExporter.
 * Credentials come from VS Code SecretStorage; the deprecated plaintext
 * settings are honoured as a fallback until the one-time migration has run.
 *
 * The transport is exclusive (webhook XOR mqtt), but the webhook transport can
 * mirror every payload to additional servers declared in config.json
 * (`export.webhookTargets`), each with its own SecretStorage credentials.
 */
export class AuthProvider {
  constructor(
    private readonly cfg: MallardConfig,
    private readonly context: vscode.ExtensionContext,
    private readonly webhookTargets: readonly WebhookTarget[] = [],
  ) {}

  async createExporter(): Promise<MetricExporter> {
    const { cfg, context } = this;
    const transport = cfg.export.transport;

    if (!transport) return new NullMetricExporter();

    const queue = new ExportQueue(context.globalStorageUri.fsPath);
    const cert = cfg.shared.certificate;

    if (transport === 'webhook') {
      const protocols: MetricProtocol[] = [];

      const primary = await this.buildWebhookProtocol(cfg.server.url, undefined);
      if (primary) protocols.push(primary);

      for (const target of this.webhookTargets) {
        const p = await this.buildWebhookProtocol(target.url, target.name);
        if (p) protocols.push(p);
      }

      if (protocols.length === 0) return new NullMetricExporter();
      const protocol = protocols.length === 1 ? protocols[0]! : new FanoutProtocol(protocols);
      return new MetricExporter(protocol, new MetricPayloadSerializer(), queue);
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

  /**
   * Build one webhook protocol for `url`. `targetName` undefined = the primary
   * target (mallard.server.url) using the base SecretStorage keys with
   * deprecated-settings fallback; a named target reads only its own
   * `<key>:<name>` SecretStorage entries. Auth method and mTLS cert paths are
   * shared across targets — per-target is credentials only.
   */
  private async buildWebhookProtocol(
    url: string,
    targetName: string | undefined,
  ): Promise<MetricProtocol | null> {
    const { cfg, context } = this;
    if (!url) return null;

    const key = (base: (typeof SECRET_KEYS)[keyof typeof SECRET_KEYS]) =>
      targetName === undefined ? base : targetSecretKey(base, targetName);

    const apiKey =
      (await context.secrets.get(key(SECRET_KEYS.webhookApiKey))) ||
      (targetName === undefined ? cfg.webhook.apiKey : '');
    const bearerToken =
      (await context.secrets.get(key(SECRET_KEYS.webhookBearerToken))) ||
      (targetName === undefined ? cfg.webhook.bearerToken : '');
    // Optional HMAC request signing (X-Mallard-Signature-256). Set via
    // "Mallard: Set Webhook Signing Secret" (or Manage Credentials for named
    // targets); must match the server's WEBHOOK_HMAC_SECRETS entry.
    const signingSecret = await context.secrets.get(key(SECRET_KEYS.webhookSigningSecret));

    const headers: Record<string, string> = {};
    if (cfg.webhook.auth === 'apiKey' && apiKey) {
      headers['X-API-Key'] = apiKey;
    } else if (cfg.webhook.auth === 'bearer' && bearerToken) {
      headers['Authorization'] = `Bearer ${bearerToken}`;
    }

    const cert = cfg.shared.certificate;
    const certOpts =
      cfg.webhook.auth === 'certificate'
        ? {
            ...opt('certFile', cert.file || undefined),
            ...opt('keyFile', cert.keyFile || undefined),
            ...opt('caFile', cert.caFile || undefined),
          }
        : {};

    return createWebhookProtocol({
      url,
      ...opt('secret', signingSecret || undefined),
      ...opt('headers', Object.keys(headers).length > 0 ? headers : undefined),
      ...certOpts,
    });
  }
}
