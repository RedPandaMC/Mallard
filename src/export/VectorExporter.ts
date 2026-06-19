/**
 * Edge-device vector export: publishes usage feature vectors to an MQTT broker
 * after each snapshot. Designed so the export path never throws or blocks the
 * dashboard — all errors are logged and swallowed.
 *
 * Only mqtts:// and wss:// (TLS) URLs are accepted. Plain mqtt:// is rejected
 * with a one-time warning to keep data in transit encrypted.
 */
import * as mqtt from 'mqtt';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import type { VectorPayload } from './vectorize';

export interface VectorExporter {
  export(payload: VectorPayload): void;
  dispose(): void;
}

export class MqttVectorExporter implements VectorExporter {
  private client: mqtt.MqttClient | null = null;
  private topic: string = '';

  constructor(brokerUrl: string, topicPrefix: string, username?: string, password?: string) {
    if (!brokerUrl.startsWith('mqtts://') && !brokerUrl.startsWith('wss://')) {
      void vscode.window.showWarningMessage(
        'Mallard: mallard.vectorExport.brokerUrl must use mqtts:// or wss:// (TLS required). ' +
          'Vector export is disabled until a secure URL is configured.',
      );
      return;
    }

    const instanceHash = crypto
      .createHash('sha256')
      .update(vscode.env.machineId)
      .digest('hex')
      .slice(0, 12);
    this.topic = `${topicPrefix}/${instanceHash}`;

    this.client = mqtt.connect(brokerUrl, {
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
      reconnectPeriod: 5_000,
      keepalive: 60,
    });

    this.client.on('error', (err: Error) => {
      console.error('[mallard] vector export connection error:', err.message);
    });
  }

  export(payload: VectorPayload): void {
    if (!this.client?.connected) return;
    this.client.publish(this.topic, JSON.stringify(payload), { qos: 0 }, (err?: Error) => {
      if (err) console.error('[mallard] vector publish error:', err.message);
    });
  }

  dispose(): void {
    this.client?.end(true);
    this.client = null;
  }
}
