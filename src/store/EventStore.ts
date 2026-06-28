/* c8 ignore next */
/**
 * Lifecycle facade for the DuckDB-backed event store.
 *
 * Responsibilities: open/close the database, run DDL, construct and expose the
 * purpose-built reader, writer, meta, and file-reader objects. All business
 * logic lives in those classes — EventStore stays thin.
 */
import { mkdirSync } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { CREATE_SQL } from './schema';
import { EventWriter } from './EventWriter';
import { EventReader } from './EventReader';
import { MetaStore } from './MetaStore';
import { DuckDBFileReader } from './DuckDBFileReader';

export class EventStore implements vscode.Disposable {
  readonly reader: EventReader;
  readonly writer: EventWriter;
  readonly meta: MetaStore;
  readonly fileReader: DuckDBFileReader;

  private constructor(
    private readonly instance: DuckDBInstance,
    readonly conn: DuckDBConnection,
    retentionDays?: number,
  ) {
    this.meta       = new MetaStore(conn);
    this.reader     = new EventReader(conn);
    this.writer     = new EventWriter(conn, retentionDays);
    this.fileReader = new DuckDBFileReader(conn, this.writer);
  }

  static async open(dir: string, retentionDays?: number): Promise<EventStore> {
    mkdirSync(dir, { recursive: true });
    const instance = await DuckDBInstance.create(path.join(dir, 'events.duckdb'));
    const conn = await instance.connect();

    // Set session timezone so all TIMESTAMPTZ operations use local time (DST-correct).
    /* c8 ignore start */
    let tz: string;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; }
    catch { tz = 'UTC'; }
    /* c8 ignore stop */
    await conn.run(`SET TimeZone = '${tz.replace(/'/g, "''")}'`);

    await conn.run(CREATE_SQL);
    return new EventStore(instance, conn, retentionDays);
  }

  // ── Convenience passthroughs ───────────────────────────────────────────────

  count(filter?: Parameters<EventReader['count']>[0]): Promise<number> {
    return this.reader.count(filter);
  }

  getMeta(key: string): Promise<string | null> { return this.meta.get(key); }
  setMeta(key: string, value: string): Promise<void> { return this.meta.set(key, value); }
  compact(now?: number): Promise<void> { return this.writer.compact(now); }

  /** Full wipe — events, meta, facts, dimension tables, snap cache. */
  clear(): Promise<void> { return this.writer.clear(); }

  dispose(): void {
    /* c8 ignore next */
    try { this.conn.closeSync(); } catch { /* ignore */ }
    /* c8 ignore next */
    try { this.instance.closeSync(); } catch { /* ignore */ }
  }
}

// ── rollupEvents ──────────────────────────────────────────────────────────────

import { CostCategory, UsageEvent } from '../domain/types';
import { UNATTRIBUTED_REPO } from '../domain/aggregate';
import { startOf } from '../util/time';

type Categories = Partial<Record<CostCategory, number>>;

function addCategories(a?: Categories, b?: Categories): Categories | undefined {
  if (!a && !b) return undefined;
  /* c8 ignore next */
  const out: Categories = { ...(a ?? {}) };
  /* c8 ignore next */
  for (const [k, v] of Object.entries(b ?? {})) {
    /* c8 ignore next */
    out[k as CostCategory] = (out[k as CostCategory] ?? 0) + (v ?? 0);
  }
  return out;
}

/** Collapse old per-request events into one row per day/model/repo/surface. */
/* c8 ignore next */
export function rollupEvents(old: UsageEvent[]): UsageEvent[] {
  const map = new Map<string, UsageEvent>();
  for (const e of old) {
    const day = startOf(e.ts, 'day');
    /* c8 ignore next */
    const key = `roll:${day}:${e.modelId}:${e.repo ?? UNATTRIBUTED_REPO}:${e.surface}`;
    const existing = map.get(key);
    if (existing) {
      existing.credits += e.credits;
      existing.cost += e.cost;
      existing.promptTokens = (existing.promptTokens ?? 0) + (e.promptTokens ?? 0);
      existing.completionTokens = (existing.completionTokens ?? 0) + (e.completionTokens ?? 0);
      const merged = addCategories(existing.costByCategory, e.costByCategory);
      if (merged) existing.costByCategory = merged;
    } else {
      map.set(key, { ...e, id: key, ts: day, estimated: true });
    }
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}
