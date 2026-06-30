import { MetricExporter, MetricProtocol, MqttProtocol } from './MetricExporter';
import { MetricPayloadSerializer } from './payload';
import { WebhookProtocol } from './WebhookProtocol';

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
}

/** Creates a MetricExporter backed by MQTT. Returns null when brokerUrl is absent. */
export function createMetricExporter(cfg: Partial<MqttExporterConfig>): MetricExporter | null {
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
  return new MetricExporter(protocol, new MetricPayloadSerializer());
}

/** Creates a MetricExporter backed by HTTP webhook. Returns null when url is absent. */
export function createWebhookExporter(cfg: Partial<WebhookExporterConfig>): MetricExporter | null {
  if (!cfg.url) return null;
  const protocol = new WebhookProtocol({
    url: cfg.url,
    ...(cfg.secret ? { secret: cfg.secret } : {}),
    ...(cfg.headers ? { headers: cfg.headers } : {}),
    ...(cfg.retries !== undefined ? { retries: cfg.retries } : {}),
  });
  return new MetricExporter(protocol, new MetricPayloadSerializer());
}

/**
 * FanoutProtocol: sends to multiple transports simultaneously.
 * Use when both MQTT and webhook are configured.
 */
export class FanoutProtocol implements MetricProtocol {
  constructor(private readonly protocols: MetricProtocol[]) {}
  send(topic: string, payload: Record<string, unknown>): void {
    for (const p of this.protocols) p.send(topic, payload);
  }
  dispose(): void {
    for (const p of this.protocols) p.dispose();
  }
}
