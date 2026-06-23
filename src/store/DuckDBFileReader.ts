/* c8 ignore start */
import { DuckDBConnection } from '@duckdb/node-api';
import type { UsageEvent } from '../domain/types';
import type { ParseContext } from '../ingest/otelParse';
import type { IEventWriter } from './EventWriter';
/* c8 ignore stop */

export type RowMapper = (row: Record<string, unknown>, ctx: ParseContext) => UsageEvent | null;

/**
 * Ingests NDJSON/log files via DuckDB's built-in C++ `read_ndjson` reader.
 *
 * This is the hot ingest path: no JS file I/O, no JS JSON parsing, no byte
 * offsets. DuckDB reads and parses the files in C++, filters rows newer than
 * the watermark timestamp, and hands back structured objects. `mapRow` is the
 * thin TS mapping layer that converts raw DuckDB rows into typed UsageEvents.
 */
export class DuckDBFileReader {
  constructor(
    private readonly conn: DuckDBConnection,
    private readonly writer: IEventWriter,
  ) {}

  /**
   * Read all NDJSON files matching `globs`, filter to rows newer than
   * `sinceMs` (epoch-ms watermark), map each row to a UsageEvent, and insert.
   *
   * `ignore_errors := true` silently drops malformed records (e.g. partial
   * lines written mid-flush). `auto_detect := true` lets DuckDB infer column
   * types from the JSON content.
   */
  async ingestGlob(
    globs: string | string[],
    mapRow: RowMapper,
    ctx: ParseContext,
    sinceMs?: number,
  ): Promise<number> {
    const globArray = Array.isArray(globs) ? globs : [globs];
    if (globArray.length === 0) return 0;

    const globList = globArray.map((g) => `'${g.replace(/'/g, "''")}'`).join(', ');
    const tsFilter =
      sinceMs != null
        ? `WHERE COALESCE(epoch_ms(TRY_CAST(timestamp AS TIMESTAMPTZ)), TRY_CAST(timestamp AS BIGINT)) > ${sinceMs}`
        : '';

    let rows: Record<string, unknown>[];
    try {
      const result = await this.conn.runAndReadAll(
        `SELECT *, filename FROM read_ndjson([${globList}], ignore_errors := true, auto_detect := true, filename := true) ${tsFilter}`,
      );
      rows = result.getRowObjects() as Record<string, unknown>[];
    } catch {
      return 0;
    }

    const events = rows.map((r) => mapRow(r, ctx)).filter((e): e is UsageEvent => e !== null);
    return events.length > 0 ? this.writer.insert(events) : 0;
  }

  /**
   * Check whether any row in `globs` has a field matching `field = value`.
   * Used for cheap surface-detection pre-scans (e.g. Claude Code agent mode).
   */
  async hasField(globs: string | string[], field: string, value: string): Promise<boolean> {
    const safeField = /^[a-zA-Z_]+$/.test(field) ? field : 'type';
    const safeValue = value.replace(/'/g, "''");
    const globArray = Array.isArray(globs) ? globs : [globs];
    if (globArray.length === 0) return false;
    const globList = globArray.map((g) => `'${g.replace(/'/g, "''")}'`).join(', ');

    try {
      const result = await this.conn.runAndReadAll(
        `SELECT COUNT(*) AS cnt
         FROM read_ndjson([${globList}], ignore_errors := true, auto_detect := true, filename := true)
         WHERE ${safeField} = '${safeValue}'`,
      );
      const rows = result.getRowObjects() as Record<string, unknown>[];
      return Number(rows[0]?.['cnt'] ?? 0) > 0;
    } catch {
      return false;
    }
  }
/* c8 ignore next */
}
