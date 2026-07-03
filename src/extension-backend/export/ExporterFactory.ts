import { MetricExporter, MetricProtocol, MqttProtocol, SendResult } from './MetricExporter';
import { MetricPayloadSerializer } from './payload';
import { WebhookProtocol } from './WebhookProtocol';
import type { ExportQueue } from './ExportQueue';

export interface MqttExporterConfig {
  brokerUrl: string;
  topic: string;
  username?: string;
  password?: string;
  certPath?: string;
  keyPath?: string;
  caPath?: string;
  /** See MqttProtocolOptions.workspaceFolders. */
  workspaceFolders?: string[];
}

export interface WebhookExporterConfig {
  url: string;
  secret?: string;
  headers?: Record<string, string>;
  retries?: number;
  certFile?: string;
  keyFile?: string;
  caFile?: string;
}

/** Creates the MQTT protocol alone — used by the multi-broker fanout path. */
export function createMqttProtocol(cfg: Partial<MqttExporterConfig>): MqttProtocol | null {
  if (!cfg.brokerUrl) return null;
  return new MqttProtocol({
    brokerUrl: cfg.brokerUrl,
    topicPrefix: cfg.topic ?? 'mallard/v3/metrics',
    ...(cfg.username ? { username: cfg.username } : {}),
    ...(cfg.password ? { password: cfg.password } : {}),
    ...(cfg.certPath ? { certPath: cfg.certPath } : {}),
    ...(cfg.keyPath ? { keyPath: cfg.keyPath } : {}),
    ...(cfg.caPath ? { caPath: cfg.caPath } : {}),
    ...(cfg.workspaceFolders ? { workspaceFolders: cfg.workspaceFolders } : {}),
  });
}

/** Creates a MetricExporter backed by MQTT. Returns null when brokerUrl is absent. */
export function createMetricExporter(
  cfg: Partial<MqttExporterConfig>,
  queue?: ExportQueue,
): MetricExporter | null {
  const protocol = createMqttProtocol(cfg);
  if (!protocol) return null;
  return new MetricExporter(protocol, new MetricPayloadSerializer(), queue);
}

/** Creates the webhook protocol alone — used by the multi-target fanout path. */
export function createWebhookProtocol(
  cfg: Partial<WebhookExporterConfig>,
): WebhookProtocol | null {
  if (!cfg.url) return null;
  return new WebhookProtocol({
    url: cfg.url,
    ...(cfg.secret ? { secret: cfg.secret } : {}),
    ...(cfg.headers ? { headers: cfg.headers } : {}),
    ...(cfg.retries !== undefined ? { retries: cfg.retries } : {}),
    ...(cfg.certFile ? { certFile: cfg.certFile } : {}),
    ...(cfg.keyFile ? { keyFile: cfg.keyFile } : {}),
    ...(cfg.caFile ? { caFile: cfg.caFile } : {}),
  });
}

/** Creates a MetricExporter backed by HTTP webhook. Returns null when url is absent. */
export function createWebhookExporter(
  cfg: Partial<WebhookExporterConfig>,
  queue?: ExportQueue,
): MetricExporter | null {
  const protocol = createWebhookProtocol(cfg);
  if (!protocol) return null;
  return new MetricExporter(protocol, new MetricPayloadSerializer(), queue);
}

/**
 * FanoutProtocol: mirrors one payload to multiple webhook servers (e.g. a
 * personal and a team ingest endpoint), constructed by AuthProvider when
 * config.json declares `export.webhookTargets`. A batch is retried when every
 * failure is retryable; one fatal (4xx) target aborts the retry so a
 * misconfigured credential can't make the queue spin forever.
 */
export class FanoutProtocol implements MetricProtocol {
  constructor(private readonly protocols: MetricProtocol[]) {}
  async send(topic: string, payload: Record<string, unknown>): Promise<SendResult> {
    const results = await Promise.all(this.protocols.map((p) => p.send(topic, payload)));
    if (results.every((r) => r.ok)) return { ok: true };
    const anyFatal = results.some((r) => !r.ok && !r.retryable);
    return { ok: false, retryable: !anyFatal };
  }
  dispose(): void {
    for (const p of this.protocols) p.dispose();
  }
}
