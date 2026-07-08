/* c8 ignore next */
/**
 * The streaming wire format: one payload per batch of freshly ingested
 * usage events. All extraction, pricing, and labeling happens on-device
 * (connectors + PricingService); the server receives finished
 * business-valuable records and only has to store them.
 *
 * This is schema v1 of the streaming protocol — the earlier state-snapshot
 * payloads were deleted with it, there is exactly one wire version.
 *
 * Privacy: no repo names, branch names, or user identifiers are exported.
 * `instance_id` is a one-way SHA-256 hash of VS Code's machineId; event ids
 * embed only hashed file keys and span/uuid fragments. `language` is a
 * generic VS Code languageId (heuristically detected — directional).
 */
import type { SourceKind, UsageEvent } from '../domain/types';
import type { MetricSerializer } from './MetricExporter';
import { hashMachineId } from '../util/machineId';

/** One priced, labeled usage event — the unit of the stream. */
export interface StreamEvent {
  /** Client event id (hashed file key + span/uuid) — stable across re-sends, usable for dedup. */
  id: string;
  /** Unix epoch milliseconds of the usage itself (not of the send). */
  ts: number;
  /** Which connector produced the event (copilot='local', claude-code, ...). */
  connector: SourceKind;
  model: string;
  surface: string;
  credits: number;
  cost_usd: number;
  /** True when the cost is log-derived (credit multiplier) rather than exact token pricing. */
  estimated: boolean;
  prompt_tokens?: number;
  completion_tokens?: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  thinking_tokens?: number;
  /** USD cost split per category (input/output/cache_read/cache_creation/thinking/tool). */
  cost_by_category?: Record<string, number>;
  /** Detected programming language (VS Code languageId) — heuristic, directional. */
  language?: string;
}

/** The wire payload: a batch of events from one ingest pass (chunked). */
export interface StreamBatch {
  /** Streaming-protocol version. This is v1; there are no other versions. */
  schema_version: 1;
  /** One-way SHA-256 hash of VS Code's machineId. Stable per install, not reversible. */
  instance_id: string;
  /** Unix epoch milliseconds when the batch was sent. */
  sent_at: number;
  /** Client UTC offset in minutes at send time. */
  tz_offset_minutes: number;
  events: StreamEvent[];
}

/** Cap events per payload so a full-history backfill streams as many small
 *  batches instead of one payload that blows the server's 64 KB body limit. */
export const STREAM_BATCH_MAX_EVENTS = 100;

export function toStreamEvent(e: UsageEvent): StreamEvent {
  return {
    id: e.id,
    ts: e.ts,
    connector: e.source,
    model: e.modelId,
    surface: e.surface,
    credits: e.credits,
    cost_usd: e.cost,
    estimated: e.estimated,
    ...(e.promptTokens !== undefined ? { prompt_tokens: e.promptTokens } : {}),
    ...(e.completionTokens !== undefined ? { completion_tokens: e.completionTokens } : {}),
    ...(e.cacheCreationTokens !== undefined ? { cache_creation_tokens: e.cacheCreationTokens } : {}),
    ...(e.cacheReadTokens !== undefined ? { cache_read_tokens: e.cacheReadTokens } : {}),
    ...(e.thinkingTokens !== undefined ? { thinking_tokens: e.thinkingTokens } : {}),
    ...(e.costByCategory !== undefined ? { cost_by_category: { ...e.costByCategory } } : {}),
    ...(e.language !== undefined ? { language: e.language } : {}),
  };
}

export function buildStreamBatch(events: readonly UsageEvent[]): StreamBatch {
  return {
    schema_version: 1,
    instance_id: hashMachineId(),
    sent_at: Date.now(),
    tz_offset_minutes: -new Date().getTimezoneOffset(),
    events: events.map(toStreamEvent),
  };
}

/** Split a batch of events into wire-sized chunks, oldest first. */
export function chunkEvents(
  events: readonly UsageEvent[],
  size = STREAM_BATCH_MAX_EVENTS,
): UsageEvent[][] {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const out: UsageEvent[][] = [];
  for (let i = 0; i < sorted.length; i += size) out.push(sorted.slice(i, i + size));
  return out;
}

export class StreamBatchSerializer implements MetricSerializer {
  readonly topic = 'events';

  serialize(batch: StreamBatch): Record<string, unknown> {
    return batch as unknown as Record<string, unknown>;
  }
}
