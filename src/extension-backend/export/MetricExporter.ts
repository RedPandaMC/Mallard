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
import { defaultLogger, Logger } from '../util/logger';
import { hashMachineId } from '../util/machineId';

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

/** No-op exporter used when metric export is not configured. Eliminates optional chaining. */
export class NullMetricExporter extends MetricExporter {
  private static readonly nullProtocol: MetricProtocol = {
    send() {},
    dispose() {},
  };
  private static readonly nullSerializer: MetricSerializer = {
    topic: '',
    serialize: () => ({}),
  };

  constructor() {
    super(NullMetricExporter.nullProtocol, NullMetricExporter.nullSerializer);
  }

  override export(_snapshot: UsageSnapshot): void {}
  override dispose(): void {}
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
  /**
   * Absolute paths of the workspace folders open in this VS Code window.
   * When provided, a stable 8-char hash of the sorted paths is appended as a
   * third topic segment so that multiple windows on the same machine each
   * publish to a distinct sub-topic, enabling wildcard fan-in at the consumer.
   * Without this, all windows share one topic and overwrite each other.
   */
  workspaceFolders?: string[];
}

export class MqttProtocol implements MetricProtocol {
  private client: mqtt.MqttClient | null = null;
  private readonly resolvedTopic: string;

  constructor(opts: MqttProtocolOptions, private readonly logger: Logger = defaultLogger) {
    if (!opts.brokerUrl.startsWith('mqtts://') && !opts.brokerUrl.startsWith('wss://')) {
      void vscode.window.showWarningMessage(
        'Mallard: mallard.mqtt.url must use mqtts:// or wss:// (TLS required). ' +
          'Metric export is disabled until a secure URL is configured.',
      );
      this.resolvedTopic = '';
      return;
    }

    const machineHash = hashMachineId().slice(0, 12);

    if (opts.workspaceFolders && opts.workspaceFolders.length > 0) {
      const wsHash = crypto
        .createHash('sha256')
        .update([...opts.workspaceFolders].sort().join('\n'))
        .digest('hex')
        .slice(0, 8);
      this.resolvedTopic = `${opts.topicPrefix}/${machineHash}/${wsHash}`;
    } else {
      this.resolvedTopic = `${opts.topicPrefix}/${machineHash}`;
    }

    const useMtls = opts.certPath && opts.keyPath;
    if ((opts.certPath && !opts.keyPath) || (!opts.certPath && opts.keyPath)) {
      this.logger.warn('mqtt', 'certPath and keyPath must both be set for mTLS');
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
        this.logger.error('mqtt', 'failed to read mTLS cert files:', (err as Error).message);
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
      this.logger.error('mqtt', 'connection error:', err.message);
    });
  }

  send(topic: string, payload: Record<string, unknown>): void {
    if (!this.client?.connected || !this.resolvedTopic) return;
    // The topic passed by MetricExporter is the serializer's logical topic;
    // we publish to the instance-scoped resolved topic instead.
    void topic;
    this.client.publish(this.resolvedTopic, JSON.stringify(payload), { qos: 1, retain: true }, (err?: Error) => {
      if (err) this.logger.error('mqtt', 'publish error:', err.message);
    });
  }

  dispose(): void {
    this.client?.end(true);
    this.client = null;
  }
}
