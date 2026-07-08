import * as vscode from 'vscode';
import type { MallardConfig } from '../config';
import type { ExportConfig } from '../domain/types';
import { SECRET_KEYS, targetSecretKey, type SecretKey } from '../app/credentials';
import {
  createMqttProtocol,
  createWebhookProtocol,
} from './ExporterFactory';
import {
  FanoutMetricExporter,
  MetricExporter,
  NullMetricExporter,
  type MetricProtocol,
} from './MetricExporter';
import { StreamBatchSerializer } from './payload';
import { ExportQueue } from './ExportQueue';
import { opt } from '../util/lang';

/**
 * Reads transport + auth config and builds the appropriate MetricExporter.
 * All credentials come from VS Code SecretStorage, never from settings.
 *
 * The transport is exclusive (webhook XOR mqtt), but either transport can
 * mirror every payload to additional targets declared in config.json
 * (`export.webhookTargets` / `export.mqttTargets`), each with its own
 * SecretStorage credentials namespaced by target name.
 */
export class AuthProvider {
  constructor(
    private readonly cfg: MallardConfig,
    private readonly context: vscode.ExtensionContext,
    private readonly exportCfg: ExportConfig = {},
  ) {}

  async createExporter(): Promise<MetricExporter> {
    const { cfg, context } = this;
    const transport = cfg.export.transport;

    if (!transport) return new NullMetricExporter();

    const dir = context.globalStorageUri.fsPath;
    // (protocol, queueFile) pairs — each target gets its OWN persisted queue so a
    // partial outage re-delivers only to the target that failed (no double-send).
    const built: Array<{ protocol: MetricProtocol; queueFile: string }> = [];
    const queueFileFor = (name: string | undefined): string =>
      name === undefined
        ? 'export-queue.json'
        : `export-queue-${name.replace(/[^a-z0-9._-]/gi, '_')}.json`;

    if (transport === 'webhook') {
      const primary = await this.buildWebhookProtocol(cfg.server.url, undefined);
      if (primary) built.push({ protocol: primary, queueFile: queueFileFor(undefined) });
      for (const target of this.exportCfg.webhookTargets ?? []) {
        const p = await this.buildWebhookProtocol(target.url, target.name);
        if (p) built.push({ protocol: p, queueFile: queueFileFor(target.name) });
      }
    } else if (transport === 'mqtt') {
      const primary = await this.buildMqttProtocol(cfg.mqtt.url || cfg.server.url, undefined);
      if (primary) built.push({ protocol: primary, queueFile: queueFileFor(undefined) });
      for (const target of this.exportCfg.mqttTargets ?? []) {
        const p = await this.buildMqttProtocol(target.url, target.name);
        if (p) built.push({ protocol: p, queueFile: queueFileFor(target.name) });
      }
    }

    if (built.length === 0) return new NullMetricExporter();

    const serializer = new StreamBatchSerializer();
    const exporters = built.map(
      (b) => new MetricExporter(b.protocol, serializer, new ExportQueue(dir, b.queueFile)),
    );
    return exporters.length === 1 ? exporters[0]! : new FanoutMetricExporter(exporters);
  }

  /** Per-target SecretStorage key: base key for the primary, `key:name` for named targets. */
  private key(base: SecretKey, targetName: string | undefined): string {
    return targetName === undefined ? base : targetSecretKey(base, targetName);
  }

  /**
   * Build one webhook protocol for `url`. `targetName` undefined = the primary
   * target (mallard.server.url). Auth method and mTLS cert paths are shared
   * across targets — per-target is credentials only.
   */
  private async buildWebhookProtocol(
    url: string,
    targetName: string | undefined,
  ): Promise<MetricProtocol | null> {
    const { cfg, context } = this;
    if (!url) return null;

    const apiKey = await context.secrets.get(this.key(SECRET_KEYS.webhookApiKey, targetName));
    const bearerToken = await context.secrets.get(
      this.key(SECRET_KEYS.webhookBearerToken, targetName),
    );
    // Optional HMAC request signing (X-Mallard-Signature-256). Set via
    // "Mallard: Set Webhook Signing Secret" (or Manage Credentials for named
    // targets); must match the server's WEBHOOK_HMAC_SECRETS entry.
    const signingSecret = await context.secrets.get(
      this.key(SECRET_KEYS.webhookSigningSecret, targetName),
    );

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

  /**
   * Build one MQTT protocol for `url`. `targetName` undefined = the primary
   * broker (mallard.mqtt.url / mallard.server.url). Username and cert paths
   * are shared; the CONNECT password is per-broker.
   */
  private async buildMqttProtocol(
    url: string,
    targetName: string | undefined,
  ): Promise<MetricProtocol | null> {
    const { cfg, context } = this;
    if (!url) return null;

    const password =
      (await context.secrets.get(this.key(SECRET_KEYS.mqttPassword, targetName))) ?? '';
    const cert = cfg.shared.certificate;
    const workspaceFolders = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath);

    return createMqttProtocol({
      brokerUrl: url,
      ...opt('username', cfg.mqtt.username || undefined),
      ...opt('password', password || undefined),
      ...opt('certPath', cert.file || undefined),
      ...opt('keyPath', cert.keyFile || undefined),
      ...opt('caPath', cert.caFile || undefined),
      ...(workspaceFolders?.length ? { workspaceFolders } : {}),
    });
  }
}
