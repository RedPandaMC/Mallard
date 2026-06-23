/* c8 ignore start */
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
import { Kysely } from 'kysely';
import { DuckDbDialect } from '@oorabona/kysely-duckdb';
import { CREATE_SQL, EventWriter } from './EventWriter';
import { EventReader } from './EventReader';
import { KyselyMetaStore } from './MetaStore';
import { DuckDBFileReader } from './DuckDBFileReader';
import type { Database } from './db-types';
/* c8 ignore stop */

export class EventStore implements vscode.Disposable {
  readonly reader: EventReader;
  readonly writer: EventWriter;
  readonly meta: KyselyMetaStore;
  readonly fileReader: DuckDBFileReader;

  private constructor(
    private readonly instance: DuckDBInstance,
    private readonly conn: DuckDBConnection,
  ) {
    // The dialect package bundles its own version of kysely and @duckdb/node-api.
    // TypeScript sees them as structurally distinct from our installed versions,
    // so we cast through unknown to satisfy the type checker. At runtime they are
    // compatible — same API surface, just different private class member tokens.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = new Kysely<Database>({ dialect: new DuckDbDialect({ database: instance as any }) as any });
    this.meta       = new KyselyMetaStore(db);
    this.reader     = new EventReader(db);
    this.writer     = new EventWriter(conn, db);
    this.fileReader = new DuckDBFileReader(conn, this.writer);
  }

  static async open(dir: string): Promise<EventStore> {
    mkdirSync(dir, { recursive: true });
    const instance = await DuckDBInstance.create(path.join(dir, 'events.duckdb'));
    const conn = await instance.connect();
    await conn.run(CREATE_SQL);
    return new EventStore(instance, conn);
  }

  // ── Convenience passthroughs ───────────────────────────────────────────────

  count(filter?: Parameters<EventReader['count']>[0]): Promise<number> {
    return this.reader.count(filter);
  }

  getMeta(key: string): Promise<string | null> { return this.meta.get(key); }
  setMeta(key: string, value: string): Promise<void> { return this.meta.set(key, value); }
  compact(now?: number): Promise<void> { return this.writer.compact(now); }

  /** Full wipe — events, meta, facts, dimension tables. */
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
