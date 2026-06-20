import { MetricExporter, MqttProtocol } from './MetricExporter';
import { MetricPayloadSerializer } from './payload';

export interface ExporterConfig {
  brokerUrl: string;
  topic: string;
  username?: string;
  password?: string;
  certPath?: string;
  keyPath?: string;
  caPath?: string;
}

export function createMetricExporter(cfg: Partial<ExporterConfig>): MetricExporter | null {
  if (!cfg.brokerUrl) return null;
  const protocol = new MqttProtocol({
    brokerUrl: cfg.brokerUrl,
    topicPrefix: cfg.topic ?? 'mallard/v2/metrics',
    ...(cfg.username ? { username: cfg.username } : {}),
    ...(cfg.password ? { password: cfg.password } : {}),
    ...(cfg.certPath ? { certPath: cfg.certPath } : {}),
    ...(cfg.keyPath ? { keyPath: cfg.keyPath } : {}),
    ...(cfg.caPath ? { caPath: cfg.caPath } : {}),
  });
  return new MetricExporter(protocol, new MetricPayloadSerializer());
}
