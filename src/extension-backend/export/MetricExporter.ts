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
import type { ExportQueue } from './ExportQueue';

// ── Interfaces ──────────────────────────────────────────────────────────────

/**
 * Outcome of a single send attempt. `retryable: false` means the payload
 * itself is the problem (bad auth, malformed body) and will never succeed no
 * matter how many times it's retried — the queue should drop it rather than
 * hold a slot for it forever. `retryable: true` means the endpoint is
 * unreachable right now (network error, 5xx, timeout, not connected) and the
 * same payload might succeed later.
 */
export type SendResult = { ok: true } | { ok: false; retryable: boolean };

/** Transport layer — implement for each protocol (MQTT, HTTP, NATS, …). */
export interface MetricProtocol {
  send(topic: string, payload: Record<string, unknown>): Promise<SendResult>;
  dispose(): void;
}

/** Payload shape — implement for each metric format (vector, Prometheus, …). */
export interface MetricSerializer {
  readonly topic: string;
  serialize(snapshot: UsageSnapshot): Record<string, unknown>;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export class MetricExporter {
  private flushing = false;
  private disposed = false;

  constructor(
    private readonly protocol: MetricProtocol,
    private readonly serializer: MetricSerializer,
    private readonly queue?: ExportQueue,
  ) {}

  /**
   * Flushes any queued backlog before sending the new snapshot, so delivery
   * order matches capture order. If the flush stops early because the
   * protocol is still unreachable, the new payload is queued directly rather
   * than attempted against an endpoint just proven down.
   */
  async export(snapshot: UsageSnapshot): Promise<void> {
    if (this.flushing || this.disposed) return;
    this.flushing = true;
    try {
      const stillDown = this.queue ? await this.flushQueue() : false;
      if (this.disposed) return;

      const topic = this.serializer.topic;
      const payload = this.serializer.serialize(snapshot);

      if (stillDown) {
        this.queue?.enqueue(topic, payload);
        return;
      }

      const result = await this.protocol.send(topic, payload);
      if (this.disposed) return;
      if (!result.ok && result.retryable) {
        this.queue?.enqueue(topic, payload);
      }
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Flushes queued entries oldest-first. Returns true if the flush stopped
   * early because a retryable failure was hit (the endpoint is still down) —
   * the caller should not then attempt a fresh send against it either.
   */
  private async flushQueue(): Promise<boolean> {
    if (!this.queue) return false;
    for (const entry of this.queue.peekAll()) {
      const result = await this.protocol.send(entry.topic, entry.payload);
      if (this.disposed) return true;
      if (result.ok) {
        this.queue.dequeue(entry.id);
        continue;
      }
      if (result.retryable) return true; // still down; stop here, preserve order
      this.queue.dequeue(entry.id); // fatal — will never succeed, drop it
    }
    return false;
  }

  dispose(): void {
    this.disposed = true;
    this.protocol.dispose();
  }
}

/** No-op exporter used when metric export is not configured. Eliminates optional chaining. */
export class NullMetricExporter extends MetricExporter {
  private static readonly nullProtocol: MetricProtocol = {
    async send() {
      return { ok: true };
    },
    dispose() {},
  };
  private static readonly nullSerializer: MetricSerializer = {
    topic: '',
    serialize: () => ({}),
  };

  constructor() {
    super(NullMetricExporter.nullProtocol, NullMetricExporter.nullSerializer);
  }

  override async export(_snapshot: UsageSnapshot): Promise<void> {}
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

const MQTT_ACK_TIMEOUT_MS = 3_000;

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

  /**
   * Publishes with `retain: true` on a single per-instance topic, so the
   * broker only ever keeps the *latest* retained message regardless of how
   * many queued entries a caller replays through here after an outage. That's
   * expected, not a bug: MQTT consumers see current state, not a historical
   * backfill the way a webhook receiver replaying queued entries would.
   */
  async send(topic: string, payload: Record<string, unknown>): Promise<SendResult> {
    // A permanently-invalid config (rejected in the constructor — e.g. a
    // plaintext broker URL) leaves resolvedTopic empty and no client. That's
    // a fatal config error: never retry it (would hold an export slot forever).
    if (!this.resolvedTopic) {
      return { ok: false, retryable: false };
    }
    // No client yet, or not yet connected — transient; the broker may come up.
    if (!this.client?.connected) {
      return { ok: false, retryable: true };
    }
    // The topic passed by MetricExporter is the serializer's logical topic;
    // we publish to the instance-scoped resolved topic instead.
    void topic;
    const client = this.client;
    const resolvedTopic = this.resolvedTopic;

    return new Promise<SendResult>((resolve) => {
      let settled = false;
      // dispose() calls client.end(true), a force-disconnect that doesn't
      // flush in-flight publishes — without this timeout, the ack callback
      // below could simply never fire and export() would hang.
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, retryable: true });
      }, MQTT_ACK_TIMEOUT_MS);

      client.publish(resolvedTopic, JSON.stringify(payload), { qos: 1, retain: true }, (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          this.logger.error('mqtt', 'publish error:', err.message);
          resolve({ ok: false, retryable: true });
        } else {
          resolve({ ok: true });
        }
      });
    });
  }

  dispose(): void {
    this.client?.end(true);
    this.client = null;
  }
}
