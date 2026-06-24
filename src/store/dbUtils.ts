/* c8 ignore start */
import { DuckDBConnection, DuckDBMaterializedResult, DuckDBPreparedStatement } from '@duckdb/node-api';
/* c8 ignore stop */

function readChunks<T>(result: DuckDBMaterializedResult, map: (row: Record<string, unknown>) => T): T[] {
  const names = result.columnNames();
  const out: T[] = [];
  for (let ci = 0; ci < result.chunkCount; ci++) {
    const chunk = result.getChunk(ci);
    const rows = chunk.getRows() as unknown[][];
    for (const row of rows) {
      const obj: Record<string, unknown> = {};
      names.forEach((n, i) => { obj[n] = row[i]; });
      out.push(map(obj));
    }
  }
  return out;
}

export async function readRows<T>(
  conn: DuckDBConnection,
  query: string,
  map: (row: Record<string, unknown>) => T,
): Promise<T[]> {
  return readChunks(await conn.run(query), map);
}

export async function readPrepared<T>(
  conn: DuckDBConnection,
  query: string,
  params: unknown[],
  map: (row: Record<string, unknown>) => T,
): Promise<T[]> {
  const stmt = await conn.prepare(query);
  params.forEach((p, i) => bindParam(stmt, i + 1, p));
  return readChunks(await stmt.run(), map);
}

export async function runPrepared(
  conn: DuckDBConnection,
  query: string,
  params: unknown[],
): Promise<number> {
  const stmt = await conn.prepare(query);
  params.forEach((p, i) => bindParam(stmt, i + 1, p));
  return (await stmt.run()).rowsChanged;
}

/* c8 ignore next */
export const bindParam = (stmt: DuckDBPreparedStatement, i: number, v: unknown): void => {
  if (v === null || v === undefined) stmt.bindNull(i);
  else if (typeof v === 'bigint') stmt.bindBigInt(i, v);
  else if (typeof v === 'boolean') stmt.bindBoolean(i, v);
  else if (typeof v === 'number') {
    if (Number.isInteger(v)) stmt.bindBigInt(i, BigInt(v));
    else stmt.bindDouble(i, v);
  }
  else stmt.bindVarchar(i, String(v));
};
