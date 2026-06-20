import { MqttVectorExporter, VectorExporter } from './VectorExporter';

export interface ExporterConfig {
  brokerUrl: string;
  topic: string;
  username?: string;
  password?: string;
  certPath?: string;
  keyPath?: string;
  caPath?: string;
}

export function createExporter(cfg: Partial<ExporterConfig>): VectorExporter | null {
  if (!cfg.brokerUrl) return null;
  return new MqttVectorExporter(
    cfg.brokerUrl,
    cfg.topic ?? 'mallard/usage',
    cfg.username,
    cfg.password,
    cfg.certPath,
    cfg.keyPath,
    cfg.caPath,
  );
}
