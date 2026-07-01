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

/** Creates a MetricExporter backed by MQTT. Returns null when brokerUrl is absent. */
export function createMetricExporter(
  cfg: Partial<MqttExporterConfig>,
  queue?: ExportQueue,
): MetricExporter | null {
  if (!cfg.brokerUrl) return null;
  const protocol = new MqttProtocol({
    brokerUrl: cfg.brokerUrl,
    topicPrefix: cfg.topic ?? 'mallard/v2/metrics',
    ...(cfg.username ? { username: cfg.username } : {}),
    ...(cfg.password ? { password: cfg.password } : {}),
    ...(cfg.certPath ? { certPath: cfg.certPath } : {}),
    ...(cfg.keyPath ? { keyPath: cfg.keyPath } : {}),
    ...(cfg.caPath ? { caPath: cfg.caPath } : {}),
    ...(cfg.workspaceFolders ? { workspaceFolders: cfg.workspaceFolders } : {}),
  });
  return new MetricExporter(protocol, new MetricPayloadSerializer(), queue);
}

/** Creates a MetricExporter backed by HTTP webhook. Returns null when url is absent. */
export function createWebhookExporter(
  cfg: Partial<WebhookExporterConfig>,
  queue?: ExportQueue,
): MetricExporter | null {
  if (!cfg.url) return null;
  const protocol = new WebhookProtocol({
    url: cfg.url,
    ...(cfg.secret ? { secret: cfg.secret } : {}),
    ...(cfg.headers ? { headers: cfg.headers } : {}),
    ...(cfg.retries !== undefined ? { retries: cfg.retries } : {}),
    ...(cfg.certFile ? { certFile: cfg.certFile } : {}),
    ...(cfg.keyFile ? { keyFile: cfg.keyFile } : {}),
    ...(cfg.caFile ? { caFile: cfg.caFile } : {}),
  });
  return new MetricExporter(protocol, new MetricPayloadSerializer(), queue);
}

/**
 * FanoutProtocol: sends to multiple transports simultaneously.
 * Use when both MQTT and webhook are configured. Not currently constructed
 * anywhere in production (AuthProvider only ever picks one transport); kept
 * simple rather than tracking per-protocol partial success, since there's no
 * live caller to justify the extra complexity.
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
