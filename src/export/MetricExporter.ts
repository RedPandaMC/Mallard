/**
 * Metric export infrastructure with pluggable protocol and serializer.
 *
 * Extension points:
 *   MetricProtocol — transport (MQTT, HTTP, NATS, …)
 *   MetricSerializer — payload shape (vector, Prometheus, …)
 *   MetricExporter — orchestrates the two; the only class UsageService needs.
 *
 * MqttProtocol: publishes to an MQTT broker after each snapshot.
 * Only mqtts:// and wss:// (TLS) URLs are accepted. Plain mqtt:// is rejected
 * with a one-time warning to keep data in transit encrypted.
 * mTLS: when certPath + keyPath are both set, client-certificate auth is used
 * instead of username/password. caPath pins the broker CA to prevent MITM.
 */
import * as mqtt from 'mqtt';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as vscode from 'vscode';
import type { UsageSnapshot } from '../domain/types';

// ── Interfaces ──────────────────────────────────────────────────────────────

/** Transport layer — implement for each protocol (MQTT, HTTP, NATS, …). */
export interface MetricProtocol {
  send(topic: string, payload: Record<string, unknown>): void;
  dispose(): void;
}

/** Payload shape — implement for each metric format (vector, Prometheus, …). */
export interface MetricSerializer {
  readonly topic: string;
  serialize(snapshot: UsageSnapshot): Record<string, unknown>;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export class MetricExporter {
  constructor(
    private readonly protocol: MetricProtocol,
    private readonly serializer: MetricSerializer,
  ) {}

  export(snapshot: UsageSnapshot): void {
    this.protocol.send(this.serializer.topic, this.serializer.serialize(snapshot));
  }

  dispose(): void {
    this.protocol.dispose();
  }
}

// ── MQTT protocol ─────────────────────────────────────────────────────────────

export interface MqttProtocolOptions {
  brokerUrl: string;
  topicPrefix: string;
  username?: string;
  password?: string;
  certPath?: string;
  keyPath?: string;
  caPath?: string;
}

export class MqttProtocol implements MetricProtocol {
  private client: mqtt.MqttClient | null = null;
  private readonly resolvedTopic: string;

  constructor(opts: MqttProtocolOptions) {
    if (!opts.brokerUrl.startsWith('mqtts://') && !opts.brokerUrl.startsWith('wss://')) {
      void vscode.window.showWarningMessage(
        'Mallard: mallard.metricExport.brokerUrl must use mqtts:// or wss:// (TLS required). ' +
          'Metric export is disabled until a secure URL is configured.',
      );
      this.resolvedTopic = '';
      return;
    }

    const instanceHash = crypto
      .createHash('sha256')
      .update(vscode.env.machineId)
      .digest('hex')
      .slice(0, 12);
    this.resolvedTopic = `${opts.topicPrefix}/${instanceHash}`;

    const useMtls = opts.certPath && opts.keyPath;
    if ((opts.certPath && !opts.keyPath) || (!opts.certPath && opts.keyPath)) {
      console.warn('[mallard] metric export: certPath and keyPath must both be set for mTLS');
    }

    if (useMtls) {
      let cert: Buffer;
      let key: Buffer;
      let ca: Buffer | undefined;
      try {
        cert = fs.readFileSync(opts.certPath!);
        key = fs.readFileSync(opts.keyPath!);
        if (opts.caPath) ca = fs.readFileSync(opts.caPath);
      } catch (err) {
        console.error('[mallard] metric export: failed to read mTLS cert files:', (err as Error).message);
        return;
      }
      this.client = mqtt.connect(opts.brokerUrl, {
        cert,
        key,
        ...(ca ? { ca } : {}),
        reconnectPeriod: 5_000,
        keepalive: 60,
      });
    } else {
      this.client = mqtt.connect(opts.brokerUrl, {
        ...(opts.username ? { username: opts.username } : {}),
        ...(opts.password ? { password: opts.password } : {}),
        reconnectPeriod: 5_000,
        keepalive: 60,
      });
    }

    this.client.on('error', (err: Error) => {
      console.error('[mallard] metric export connection error:', err.message);
    });
  }

  send(topic: string, payload: Record<string, unknown>): void {
    if (!this.client?.connected || !this.resolvedTopic) return;
    // The topic passed by MetricExporter is the serializer's logical topic;
    // we publish to the instance-scoped resolved topic instead.
    void topic;
    this.client.publish(this.resolvedTopic, JSON.stringify(payload), { qos: 0 }, (err?: Error) => {
      if (err) console.error('[mallard] metric publish error:', err.message);
    });
  }

  dispose(): void {
    this.client?.end(true);
    this.client = null;
  }
}
