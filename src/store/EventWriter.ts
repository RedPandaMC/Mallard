/* c8 ignore start */
import { DuckDBConnection } from '@duckdb/node-api';
import { UsageEvent } from '../domain/types';
import { UNATTRIBUTED_REPO } from '../domain/aggregate';
import { DAY_MS, startOf } from '../util/time';
import {
  CLEAR_ALL_SQL,
  CLEAR_STAGING,
  COMPACT_DELETE_SQL,
  COMPACT_ROLLUP_SQL,
  COUNT_EVENTS_SQL,
  INSERT_STAGING_MERGE,
  MAX_RAW_EVENTS,
  RAW_WINDOW_DAYS,
  REFRESH_FACTS_INSERT_MODELS_SQL,
  REFRESH_FACTS_INSERT_REPOS_SQL,
  REFRESH_FACTS_SQL,
  REFRESH_SNAP_SQL,
} from './schema';
import type { RecordFilter } from './EventRepository';
import { readRows, runPrepared } from './dbUtils';
/* c8 ignore stop */

// ── Interface ─────────────────────────────────────────────────────────────────

export interface IEventWriter {
  insert(records: UsageEvent[]): Promise<number>;
  remove(filter: RecordFilter): Promise<number>;
  compact(now?: number): Promise<void>;
  clear(): Promise<void>;
  setPrices(entries: ReadonlyArray<{ modelId: string; multiplier: number }>): Promise<void>;
}

// ── Implementation ────────────────────────────────────────────────────────────

export class EventWriter implements IEventWriter {
  constructor(private readonly conn: DuckDBConnection) {}

  async insert(records: UsageEvent[]): Promise<number> {
    if (records.length === 0) return 0;
    const inserted = await this.insertAll(records);
    const total = await readRows(this.conn, COUNT_EVENTS_SQL, (r) => Number(r['c']));
    /* c8 ignore next */
    if ((total[0] ?? 0) > MAX_RAW_EVENTS) await this.compact();
    const todayStart = startOf(Date.now(), 'day');
    await this.refreshFacts(todayStart, todayStart + DAY_MS);
    await this.conn.run(REFRESH_SNAP_SQL);
    return inserted;
  }

  async remove(filter: RecordFilter): Promise<number> {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter.range) {
      clauses.push('ts >= ? AND ts < ?');
      params.push(filter.range.start, filter.range.end);
    }
    if (filter.models?.length) {
      clauses.push(`modelId IN (${filter.models.map(() => '?').join(',')})`);
      params.push(...filter.models);
    }
    if (filter.surfaces?.length) {
      clauses.push(`surface IN (${filter.surfaces.map(() => '?').join(',')})`);
      params.push(...filter.surfaces);
    }
    if (filter.sources?.length) {
      clauses.push(`source IN (${filter.sources.map(() => '?').join(',')})`);
      params.push(...filter.sources);
    }
    if (filter.branches?.length) {
      clauses.push(`branch IN (${filter.branches.map(() => '?').join(',')})`);
      params.push(...filter.branches);
    }
    if (filter.repos?.length) {
      const named = filter.repos.filter((r) => r !== UNATTRIBUTED_REPO);
      const hasUnattr = filter.repos.includes(UNATTRIBUTED_REPO);
      const repoParts: string[] = [];
      if (named.length) {
        repoParts.push(`repo IN (${named.map(() => '?').join(',')})`);
        params.push(...named);
      }
      if (hasUnattr) repoParts.push('repo IS NULL');
      if (repoParts.length) clauses.push(`(${repoParts.join(' OR ')})`);
    }
    if (!clauses.length) return 0;

    const before = (await readRows(this.conn, COUNT_EVENTS_SQL, (r) => Number(r['c'])))[0] ?? 0;
    await runPrepared(this.conn, `DELETE FROM events WHERE ${clauses.join(' AND ')}`, params);
    const after  = (await readRows(this.conn, COUNT_EVENTS_SQL, (r) => Number(r['c'])))[0] ?? 0;
    return before - after;
  }

  async compact(now = Date.now()): Promise<void> {
    const cutoff = startOf(now - RAW_WINDOW_DAYS * DAY_MS, 'day');
    const cutoffBig = BigInt(cutoff);

    const count = (await readRows(
      this.conn,
      `SELECT COUNT(*) AS c FROM events WHERE ts < ${cutoffBig} AND id NOT LIKE 'roll:%'`,
      (r) => Number(r['c']),
    ))[0] ?? 0;
    /* c8 ignore next */
    if (count === 0) return;

    await runPrepared(this.conn, COMPACT_ROLLUP_SQL, [cutoffBig]);
    await runPrepared(this.conn, COMPACT_DELETE_SQL, [cutoffBig]);
    await this.refreshFacts();
    await this.conn.run(REFRESH_SNAP_SQL);
  }

  async clear(): Promise<void> {
    await this.conn.run(CLEAR_ALL_SQL);
  }

  async setPrices(entries: ReadonlyArray<{ modelId: string; multiplier: number }>): Promise<void> {
    await this.conn.run('DELETE FROM prices');
    if (entries.length === 0) return;
    const stmt = await this.conn.prepare(
      `INSERT INTO prices (modelId, multiplier) VALUES (?, ?)`,
    );
    for (const e of entries) {
      stmt.bindVarchar(1, e.modelId);
      stmt.bindDouble(2, e.multiplier);
      await stmt.run();
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async insertAll(events: UsageEvent[]): Promise<number> {
    /* c8 ignore next */
    if (events.length === 0) return 0;
    await this.conn.run('DELETE FROM events_staging');

    const appender = await this.conn.createAppender('events_staging');
    for (const e of events) {
      appender.appendVarchar(e.id);
      appender.appendBigInt(BigInt(e.ts));
      appender.appendVarchar(e.modelId);
      appender.appendVarchar(e.surface);
      appender.appendVarchar(e.source);
      appender.appendDouble(e.credits);
      appender.appendDouble(e.cost);
      if (e.promptTokens != null)     appender.appendInteger(e.promptTokens);     else appender.appendNull();
      if (e.completionTokens != null) appender.appendInteger(e.completionTokens); else appender.appendNull();
      appender.appendBoolean(e.estimated);
      if (e.repo != null)             appender.appendVarchar(e.repo);             else appender.appendNull();
      if (e.costByCategory)           appender.appendVarchar(JSON.stringify(e.costByCategory)); else appender.appendNull();
      if (e.branch != null)           appender.appendVarchar(e.branch);           else appender.appendNull();
      appender.endRow();
    }
    appender.flushSync();
    appender.closeSync();

    const before = (await readRows(this.conn, COUNT_EVENTS_SQL, (r) => Number(r['c'])))[0] ?? 0;
    await this.conn.run(INSERT_STAGING_MERGE);
    const after  = (await readRows(this.conn, COUNT_EVENTS_SQL, (r) => Number(r['c'])))[0] ?? 0;
    await this.conn.run(CLEAR_STAGING);
    return after - before;
  }

  async refreshFacts(windowStart = 0, windowEnd = Date.now() + DAY_MS): Promise<void> {
    await this.conn.run(REFRESH_FACTS_INSERT_MODELS_SQL);
    await this.conn.run(REFRESH_FACTS_INSERT_REPOS_SQL);
    await runPrepared(this.conn, REFRESH_FACTS_SQL, [BigInt(windowStart), BigInt(windowEnd)]);
  }
}

export { UNATTRIBUTED_REPO };
