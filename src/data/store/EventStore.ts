/**
 * Per-user, append-friendly event store backed by JSONL on disk.
 *
 * The constructor takes a plain directory path (not a vscode context) so the
 * store can be unit-tested against a temp dir. Raw per-request events are kept
 * for a recent window; older events are rolled up into coarse daily rows to
 * keep the file bounded.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { matchesFilter } from '../../model/aggregate';
import { Filter, UsageEvent } from '../../model/types';
import { DAY_MS, startOf } from '../../util/time';
import { MAX_RAW_EVENTS, RAW_WINDOW_DAYS, STORE_SCHEMA_VERSION } from './schema';

/** Collapse old per-request events into one row per day/model/repo/surface. */
export function rollupEvents(old: UsageEvent[]): UsageEvent[] {
  const map = new Map<string, UsageEvent>();
  for (const e of old) {
    const day = startOf(e.ts, 'day');
    const key = `roll:${day}:${e.modelId}:${e.repo ?? 'unknown'}:${e.surface}`;
    const existing = map.get(key);
    if (existing) {
      existing.credits += e.credits;
      existing.cost += e.cost;
      existing.promptTokens = (existing.promptTokens ?? 0) + (e.promptTokens ?? 0);
      existing.completionTokens = (existing.completionTokens ?? 0) + (e.completionTokens ?? 0);
    } else {
      map.set(key, { ...e, id: key, ts: day, estimated: true });
    }
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}

export class EventStore {
  private events: UsageEvent[] = [];
  private ids = new Set<string>();
  private loaded = false;
  private readonly file: string;
  private readonly metaFile: string;

  constructor(private readonly dir: string) {
    this.file = path.join(dir, 'events.jsonl');
    this.metaFile = path.join(dir, 'meta.json');
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    await fs.mkdir(this.dir, { recursive: true });
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const e = JSON.parse(trimmed) as UsageEvent;
          if (e && e.id && !this.ids.has(e.id)) {
            this.ids.add(e.id);
            this.events.push(e);
          }
        } catch {
          // skip malformed line
        }
      }
    } catch {
      // no file yet — start empty
    }
    this.events.sort((a, b) => a.ts - b.ts);
    this.loaded = true;
  }

  /** All loaded events (read-only view). */
  all(): readonly UsageEvent[] {
    return this.events;
  }

  count(): number {
    return this.events.length;
  }

  /** Append new events (deduped by id). Returns how many were actually added. */
  async append(incoming: UsageEvent[]): Promise<number> {
    await this.load();
    const fresh = incoming.filter((e) => e && e.id && !this.ids.has(e.id));
    if (fresh.length === 0) return 0;
    for (const e of fresh) {
      this.ids.add(e.id);
      this.events.push(e);
    }
    this.events.sort((a, b) => a.ts - b.ts);
    await fs.appendFile(this.file, fresh.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    if (this.events.length > MAX_RAW_EVENTS) {
      await this.rollup();
    }
    return fresh.length;
  }

  query(filter?: Filter): UsageEvent[] {
    return filter ? this.events.filter((e) => matchesFilter(e, filter)) : this.events.slice();
  }

  async rollup(now = Date.now()): Promise<void> {
    await this.load();
    const cutoff = startOf(now - RAW_WINDOW_DAYS * DAY_MS, 'day');
    const recent = this.events.filter((e) => e.ts >= cutoff);
    const old = this.events.filter((e) => e.ts < cutoff);
    if (old.length === 0) return;
    this.events = [...rollupEvents(old), ...recent].sort((a, b) => a.ts - b.ts);
    this.ids = new Set(this.events.map((e) => e.id));
    await this.rewrite();
  }

  async clear(): Promise<void> {
    await this.load();
    this.events = [];
    this.ids.clear();
    await this.rewrite();
  }

  async export(): Promise<string> {
    await this.load();
    return JSON.stringify(this.events, null, 2);
  }

  private async rewrite(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const body = this.events.length
      ? this.events.map((e) => JSON.stringify(e)).join('\n') + '\n'
      : '';
    await fs.writeFile(this.file, body, 'utf8');
    await fs.writeFile(
      this.metaFile,
      JSON.stringify({ version: STORE_SCHEMA_VERSION, updated: Date.now() }),
      'utf8',
    );
  }
}
