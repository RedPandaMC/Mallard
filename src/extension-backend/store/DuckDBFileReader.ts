/* c8 ignore next */
import { DuckDBConnection, JsonDuckDBValueConverter } from '@duckdb/node-api';
import type { UsageEvent } from '../domain/types';
import type { ParseContext } from '../ingest/otelParse';
import type { IEventWriter } from './EventWriter';
import { defaultLogger, Logger } from '../util/logger';

export type RowMapper = (row: Record<string, unknown>, ctx: ParseContext) => UsageEvent | null;

/**
 * DuckDB's `read_ndjson` throws "No files found that match the pattern …" when
 * a glob matches zero files on disk. That is an expected, benign condition
 * (a discovered log dir may simply contain no matching files), not a failure —
 * callers treat it as an empty result without logging noise.
 */
function isNoFilesError(err: unknown): boolean {
  return /No files found/i.test(String(err));
}

/** Alias DuckDB attaches a SQLite source under; `query` selects from it. */
const SQLITE_ALIAS = 'mallard_otel';

export interface IngestResult {
  /** Rows actually inserted (after id dedup). */
  inserted: number;
  /** Highest event timestamp seen in this run (epoch ms), or null when no rows mapped. */
  maxEventTs: number | null;
}

/**
 * Ingests NDJSON/log files via DuckDB's built-in C++ `read_ndjson` reader.
 *
 * This is the hot ingest path: no JS file I/O, no JS JSON parsing, no byte
 * offsets. DuckDB reads and parses the files in C++, filters rows newer than
 * the watermark timestamp, and hands back structured objects. `mapRow` is the
 * thin TS mapping layer that converts raw DuckDB rows into typed UsageEvents.
 *
 * All calls are serialized through an async queue so concurrent connectors
 * sharing the same DuckDB connection never race on writes.
 */
export class DuckDBFileReader {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly conn: DuckDBConnection,
    private readonly writer: IEventWriter,
    private readonly logger: Logger = defaultLogger,
  ) {}

  /**
   * Read all NDJSON files matching `globs`, filter to rows newer than
   * `sinceMs` (epoch-ms watermark), map each row to a UsageEvent, and insert.
   *
   * `ignore_errors := true` silently drops malformed records (e.g. partial
   * lines written mid-flush). `auto_detect := true` lets DuckDB infer column
   * types from the JSON content.
   *
   * Calls are serialized through an internal queue — safe to call from
   * multiple connectors concurrently.
   */
  ingestGlob(
    globs: string | string[],
    mapRow: RowMapper,
    ctx: ParseContext,
    sinceMs?: number,
  ): Promise<IngestResult> {
    const task = () => this._ingestGlob(globs, mapRow, ctx, sinceMs);
    this.queue = this.queue.then(task, task);
    return this.queue as Promise<IngestResult>;
  }

  /**
   * Stream a query chunk-by-chunk, mapping each chunk's rows to UsageEvents
   * and discarding the raw rows immediately. Raw log rows (full JSON payloads)
   * are 10-100x heavier than mapped events, so never materializing the whole
   * result set bounds ingest memory on very large logs. Values are converted
   * with the same JSON converter getRowObjectsJson() uses, so nested
   * STRUCT/LIST columns still unwrap into plain JS objects/arrays that mapRow
   * can navigate (e.g. a Claude row's `message.usage`).
   */
  private async streamEvents(
    sql: string,
    mapRow: RowMapper,
    ctx: ParseContext,
  ): Promise<{ events: UsageEvent[]; rowsRead: number }> {
    const result = await this.conn.stream(sql);
    const columnNames = result.deduplicatedColumnNames();
    const events: UsageEvent[] = [];
    let rowsRead = 0;
    for (;;) {
      const chunk = await result.fetchChunk();
      if (!chunk || chunk.rowCount === 0) break;
      const chunkRows = chunk.convertRows(JsonDuckDBValueConverter);
      for (const values of chunkRows) {
        rowsRead++;
        const row: Record<string, unknown> = {};
        for (let i = 0; i < columnNames.length; i++) row[columnNames[i]!] = values[i];
        const ev = mapRow(row, ctx);
        if (ev !== null) events.push(ev);
      }
    }
    return { events, rowsRead };
  }

  private async _ingestGlob(
    globs: string | string[],
    mapRow: RowMapper,
    ctx: ParseContext,
    sinceMs?: number,
  ): Promise<IngestResult> {
    const globArray = Array.isArray(globs) ? globs : [globs];
    if (globArray.length === 0) return { inserted: 0, maxEventTs: null };

    const globList = globArray.map((g) => `'${g.replace(/'/g, "''")}'`).join(', ');
    // sinceMs is an internal epoch-ms watermark; the integer guard keeps any
    // non-numeric value out of the SQL text.
    const tsFilter =
      sinceMs != null && Number.isFinite(sinceMs)
        ? `WHERE COALESCE(epoch_ms(TRY_CAST(timestamp AS TIMESTAMPTZ)), TRY_CAST(timestamp AS BIGINT)) > ${Math.floor(sinceMs)}`
        : '';

    let events: UsageEvent[];
    let rowsRead: number;
    try {
      ({ events, rowsRead } = await this.streamEvents(
        `SELECT *, filename FROM read_ndjson([${globList}], ignore_errors := true, auto_detect := true, filename := true) ${tsFilter}`,
        mapRow,
        ctx,
      ));
    } catch (err) {
      if (isNoFilesError(err)) return { inserted: 0, maxEventTs: null };
      this.logger.warn('duckdb', `ingest failed for [${globArray.join(', ')}]: ${String(err)}`);
      return { inserted: 0, maxEventTs: null };
    }

    this.logger.debug(
      'duckdb',
      `ingest [${globArray.join(', ')}]: ${rowsRead} rows read, ${events.length} events mapped`,
    );
    if (events.length === 0) return { inserted: 0, maxEventTs: null };
    const inserted = await this.writer.insert(events);
    const maxEventTs = events.reduce((max, e) => Math.max(max, e.ts), Number.NEGATIVE_INFINITY);
    return { inserted, maxEventTs };
  }

  /**
   * Read rows from a SQLite database via DuckDB's sqlite scanner and map them
   * to UsageEvents. `query` must SELECT from the attached alias `mallard_otel`
   * (e.g. `SELECT * FROM mallard_otel.spans`). Serialized through the same
   * queue as ingestGlob so the shared connection never races.
   */
  ingestSqlite(dbPath: string, query: string, mapRow: RowMapper, ctx: ParseContext): Promise<IngestResult> {
    const task = () => this._ingestSqlite(dbPath, query, mapRow, ctx);
    this.queue = this.queue.then(task, task);
    return this.queue as Promise<IngestResult>;
  }

  private sqliteExtensionReady = false;

  /** Load the DuckDB sqlite extension once per connection (idempotent). */
  private async ensureSqliteExtension(): Promise<void> {
    if (this.sqliteExtensionReady) return;
    await this.conn.run('INSTALL sqlite');
    await this.conn.run('LOAD sqlite');
    this.sqliteExtensionReady = true;
  }

  private async _ingestSqlite(
    dbPath: string,
    query: string,
    mapRow: RowMapper,
    ctx: ParseContext,
  ): Promise<IngestResult> {
    const safePath = dbPath.replace(/'/g, "''");
    try {
      // INSTALL/LOAD are idempotent per connection — do them once, not on every
      // debounced file-watcher tick. ATTACH/DETACH stay per-call since the
      // underlying sqlite file changes between ingests.
      await this.ensureSqliteExtension();
      await this.conn.run(`ATTACH '${safePath}' AS ${SQLITE_ALIAS} (TYPE sqlite, READ_ONLY)`);
    } catch (err) {
      this.logger.warn('duckdb', `sqlite attach failed for ${dbPath}: ${String(err)}`);
      return { inserted: 0, maxEventTs: null };
    }

    let events: UsageEvent[] = [];
    let rowsRead = 0;
    try {
      ({ events, rowsRead } = await this.streamEvents(query, mapRow, ctx));
    } catch (err) {
      this.logger.warn('duckdb', `sqlite query failed for ${dbPath}: ${String(err)}`);
    } finally {
      try {
        await this.conn.run(`DETACH ${SQLITE_ALIAS}`);
      } /* c8 ignore next 3 */ catch {
        // best-effort: connection already gone
      }
    }

    this.logger.debug(
      'duckdb',
      `sqlite ingest ${dbPath}: ${rowsRead} rows read, ${events.length} events mapped`,
    );
    if (events.length === 0) return { inserted: 0, maxEventTs: null };
    const inserted = await this.writer.insert(events);
    const maxEventTs = events.reduce((max, e) => Math.max(max, e.ts), Number.NEGATIVE_INFINITY);
    return { inserted, maxEventTs };
  }

  /**
   * Check whether any row in `globs` has a field matching `field = value`.
   * Used for cheap surface-detection pre-scans (e.g. Claude Code agent mode).
   */
  async hasField(globs: string | string[], field: string, value: string): Promise<boolean> {
    const safeField = /^[a-zA-Z_]+$/.test(field) ? field : 'type';
    const globArray = Array.isArray(globs) ? globs : [globs];
    if (globArray.length === 0) return false;
    const globList = globArray.map((g) => `'${g.replace(/'/g, "''")}'`).join(', ');

    try {
      // The glob list cannot be bound (DuckDB disallows parameters inside
      // table-function arguments), but the compared value can be.
      const result = await this.conn.runAndReadAll(
        `SELECT COUNT(*) AS cnt
         FROM read_ndjson([${globList}], ignore_errors := true, auto_detect := true, filename := true)
         WHERE ${safeField} = ?`,
        [value],
      );
      const rows = result.getRowObjects() as Record<string, unknown>[];
      return Number(rows[0]?.['cnt'] ?? 0) > 0;
    } catch (err) {
      if (!isNoFilesError(err)) {
        this.logger.warn('duckdb', `hasField failed for [${globArray.join(', ')}]: ${String(err)}`);
      }
      return false;
    }
  }
  /* c8 ignore next */
}
