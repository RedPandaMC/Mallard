/**
 * Per-user event store backed by SQLite (better-sqlite3).
 *
 * The constructor takes a plain directory path so the store can be unit-tested
 * against a temp dir. Raw per-request events are kept for a recent window;
 * older events are rolled up into coarse daily rows to keep the DB bounded.
 *
 * On first open, any legacy `events.jsonl` in the same directory is bulk-imported
 * and renamed to `events.jsonl.migrated` so data is not lost on upgrade.
 */
import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, renameSync } from 'fs';
import * as path from 'path';
import { CostCategory, Filter, SourceKind, Surface, UsageEvent } from '../domain/types';
import { UNATTRIBUTED_REPO } from '../domain/aggregate';
import { DAY_MS, startOf } from '../util/time';
import { MAX_RAW_EVENTS, RAW_WINDOW_DAYS } from './schema';

type Categories = Partial<Record<CostCategory, number>>;

/** Sum two optional category maps; returns undefined when both are absent. */
function addCategories(a?: Categories, b?: Categories): Categories | undefined {
  if (!a && !b) return undefined;
  const out: Categories = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {})) {
    out[k as CostCategory] = (out[k as CostCategory] ?? 0) + (v ?? 0);
  }
  return out;
}

/** Collapse old per-request events into one row per day/model/repo/surface. */
export function rollupEvents(old: UsageEvent[]): UsageEvent[] {
  const map = new Map<string, UsageEvent>();
  for (const e of old) {
    const day = startOf(e.ts, 'day');
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

interface EventRow {
  id: string;
  ts: number;
  modelId: string;
  surface: string;
  source: string;
  credits: number;
  cost: number;
  promptTokens: number | null;
  completionTokens: number | null;
  estimated: number;
  repo: string | null;
  costByCategory: string | null;
}

function rowToEvent(row: EventRow): UsageEvent {
  let costByCategory: Categories | undefined;
  if (row.costByCategory) {
    try {
      costByCategory = JSON.parse(row.costByCategory) as Categories;
    } catch {
      costByCategory = undefined;
    }
  }
  return {
    id: row.id,
    ts: row.ts,
    modelId: row.modelId,
    surface: row.surface as Surface,
    source: row.source as SourceKind,
    credits: row.credits,
    cost: row.cost,
    estimated: row.estimated !== 0,
    ...(row.promptTokens !== null ? { promptTokens: row.promptTokens } : {}),
    ...(row.completionTokens !== null ? { completionTokens: row.completionTokens } : {}),
    ...(row.repo !== null ? { repo: row.repo } : {}),
    ...(costByCategory !== undefined ? { costByCategory } : {}),
  };
}

function toRow(e: UsageEvent): EventRow {
  return {
    id: e.id,
    ts: e.ts,
    modelId: e.modelId,
    surface: e.surface,
    source: e.source,
    credits: e.credits,
    cost: e.cost,
    promptTokens: e.promptTokens ?? null,
    completionTokens: e.completionTokens ?? null,
    estimated: e.estimated ? 1 : 0,
    repo: e.repo ?? null,
    costByCategory: e.costByCategory ? JSON.stringify(e.costByCategory) : null,
  };
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    ts INTEGER NOT NULL,
    modelId TEXT NOT NULL,
    surface TEXT NOT NULL,
    source TEXT NOT NULL,
    credits REAL NOT NULL,
    cost REAL NOT NULL,
    promptTokens INTEGER,
    completionTokens INTEGER,
    estimated INTEGER NOT NULL DEFAULT 1,
    repo TEXT,
    costByCategory TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ts ON events(ts);
  CREATE INDEX IF NOT EXISTS idx_model ON events(modelId);
`;

const INSERT_SQL =
  'INSERT OR IGNORE INTO events ' +
  '(id, ts, modelId, surface, source, credits, cost, promptTokens, completionTokens, estimated, repo, costByCategory) ' +
  'VALUES (@id, @ts, @modelId, @surface, @source, @credits, @cost, @promptTokens, @completionTokens, @estimated, @repo, @costByCategory)';

export class EventStore {
  private readonly db: Database.Database;
  private readonly ins: Database.Statement<[EventRow]>;
  private readonly legacyFile: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.legacyFile = path.join(dir, 'events.jsonl');
    this.db = new Database(path.join(dir, 'events.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(CREATE_TABLE);
    this.migrateSchema();
    this.ins = this.db.prepare<EventRow>(INSERT_SQL);
    this.migrateJsonl();
  }

  /** Additive column migrations for DBs created by an earlier schema version. */
  private migrateSchema(): void {
    const cols = this.db
      .prepare<[], { name: string }>('PRAGMA table_info(events)')
      .all()
      .map((c) => c.name);
    if (!cols.includes('costByCategory')) {
      this.db.exec('ALTER TABLE events ADD COLUMN costByCategory TEXT');
    }
  }

  /** No-op — migration runs synchronously in the constructor. Kept for API compatibility. */
  async load(): Promise<void> { /* noop */ }

  all(): readonly UsageEvent[] {
    return this.db
      .prepare<[], EventRow>('SELECT * FROM events ORDER BY ts')
      .all()
      .map(rowToEvent);
  }

  count(): number {
    return (this.db.prepare<[], { n: number }>('SELECT COUNT(*) as n FROM events').get()!).n;
  }

  async append(incoming: UsageEvent[]): Promise<number> {
    if (incoming.length === 0) return 0;
    const added = this.bulkInsert(incoming);
    if (this.count() > MAX_RAW_EVENTS) await this.rollup();
    return added;
  }

  query(filter?: Filter): UsageEvent[] {
    if (!filter) return this.all().slice();

    const clauses: string[] = [];
    const params: (string | number)[] = [];

    if (filter.range) {
      clauses.push('ts >= ? AND ts < ?');
      params.push(filter.range.start, filter.range.end);
    }
    const models = filter.models;
    if (models && models.length > 0) {
      clauses.push(`modelId IN (${models.map(() => '?').join(',')})`);
      params.push(...models);
    }
    const surfaces = filter.surfaces;
    if (surfaces && surfaces.length > 0) {
      clauses.push(`surface IN (${surfaces.map(() => '?').join(',')})`);
      params.push(...surfaces);
    }
    const repos = filter.repos;
    if (repos && repos.length > 0) {
      // Unattributed events are stored as NULL repo; match them via the sentinel.
      const named = repos.filter((r) => r !== UNATTRIBUTED_REPO);
      const parts: string[] = [];
      if (named.length > 0) {
        parts.push(`repo IN (${named.map(() => '?').join(',')})`);
        params.push(...named);
      }
      if (repos.includes(UNATTRIBUTED_REPO)) parts.push('repo IS NULL');
      if (parts.length > 0) clauses.push(`(${parts.join(' OR ')})`);
    }

    if (clauses.length === 0) return this.all().slice();

    const sql = `SELECT * FROM events WHERE ${clauses.join(' AND ')} ORDER BY ts`;
    return (this.db.prepare(sql).all(...params) as EventRow[]).map(rowToEvent);
  }

  async rollup(now = Date.now()): Promise<void> {
    const cutoff = startOf(now - RAW_WINDOW_DAYS * DAY_MS, 'day');
    const old = this.db
      .prepare<[number], EventRow>('SELECT * FROM events WHERE ts < ? ORDER BY ts')
      .all(cutoff)
      .map(rowToEvent);
    if (old.length === 0) return;
    const rolled = rollupEvents(old);
    const del = this.db.prepare<[number]>('DELETE FROM events WHERE ts < ?');
    const ins = this.ins;
    this.db.transaction(() => {
      del.run(cutoff);
      for (const e of rolled) ins.run(toRow(e));
    })();
  }

  async clear(): Promise<void> {
    this.db.prepare('DELETE FROM events').run();
  }

  async export(): Promise<string> {
    return JSON.stringify(this.all(), null, 2);
  }

  dispose(): void {
    this.db.close();
  }

  private bulkInsert(events: UsageEvent[]): number {
    const ins = this.ins;
    let added = 0;
    this.db.transaction(() => {
      for (const e of events) {
        const result = ins.run(toRow(e));
        added += result.changes;
      }
    })();
    return added;
  }

  private migrateJsonl(): void {
    try {
      const raw = readFileSync(this.legacyFile, 'utf8');
      const events: UsageEvent[] = [];
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const e = JSON.parse(trimmed) as UsageEvent;
          if (e?.id) events.push(e);
        } catch { /* skip malformed line */ }
      }
      if (events.length > 0) this.bulkInsert(events);
      renameSync(this.legacyFile, this.legacyFile + '.migrated');
    } catch { /* no legacy file or already migrated */ }
  }
}
