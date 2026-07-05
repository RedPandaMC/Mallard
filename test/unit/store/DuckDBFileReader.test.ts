import { strict as assert } from 'assert';
import { DuckDBFileReader } from '../../../src/extension-backend/store/DuckDBFileReader';
import type { UsageEvent } from '../../../src/extension-backend/domain/types';
import type { ParseContext } from '../../../src/extension-backend/ingest/otelParse';

const baseCtx: ParseContext = { pricePerCredit: 0.04, now: Date.now() };

function makeEvent(overrides?: Partial<UsageEvent>): UsageEvent {
  return {
    id: 'test-1', ts: Date.now(), modelId: 'gpt-4o', source: 'local' as UsageEvent['source'],
    surface: 'chat' as UsageEvent['surface'], credits: 1, cost: 0.04, estimated: false,
    ...overrides,
  };
}

function makeReader(
  rows: Record<string, unknown>[],
  insertFn?: (events: UsageEvent[]) => Promise<number>,
): DuckDBFileReader {
  const mockConn = {
    // ingestGlob reads rows via getRowObjectsJson (plain objects); hasField
    // reads a COUNT(*) via getRowObjects. Provide both.
    runAndReadAll: async () => ({ getRowObjects: () => rows, getRowObjectsJson: () => rows }),
  };
  const mockWriter = { insert: insertFn ?? (async (events: UsageEvent[]) => events.length) };
  return new DuckDBFileReader(mockConn as never, mockWriter as never);
}

describe('DuckDBFileReader — ingestGlob', () => {
  it('returns 0 immediately for empty globs array', async () => {
    const reader = makeReader([]);
    const result = await reader.ingestGlob([], () => null, baseCtx);
    assert.deepEqual(result, { inserted: 0, maxEventTs: null });
  });

  it('accepts a single string glob (not an array)', async () => {
    const event = makeEvent({ ts: 1_700_000_111_222 });
    const reader = makeReader([{ modelId: 'gpt-4o' }]);
    const result = await reader.ingestGlob('/tmp/*.jsonl', () => event, baseCtx);
    assert.equal(result.inserted, 1);
    assert.equal(result.maxEventTs, 1_700_000_111_222);
  });

  it('reports the max event timestamp across mapped rows', async () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const reader = makeReader(rows);
    let i = 0;
    const tss = [1_700_000_000_300, 1_700_000_000_100, 1_700_000_000_200];
    const result = await reader.ingestGlob(
      ['/tmp/*.jsonl'],
      () => makeEvent({ id: `e${i}`, ts: tss[i++]! }),
      baseCtx,
    );
    assert.equal(result.inserted, 3);
    assert.equal(result.maxEventTs, 1_700_000_000_300);
  });

  it('includes WHERE clause when sinceMs is provided', async () => {
    let capturedSql = '';
    const mockConn = {
      runAndReadAll: async (sql: string) => { capturedSql = sql; return { getRowObjects: () => [], getRowObjectsJson: () => [] }; },
    };
    const reader = new DuckDBFileReader(mockConn as never, { insert: async () => 0 } as never);
    await reader.ingestGlob(['/tmp/*.jsonl'], () => null, baseCtx, 1_700_000_000_000);
    assert.ok(capturedSql.includes('WHERE'), 'sinceMs filter should add a WHERE clause');
    assert.ok(capturedSql.includes('1700000000000'));
  });

  it('omits WHERE clause when sinceMs is undefined', async () => {
    let capturedSql = '';
    const mockConn = {
      runAndReadAll: async (sql: string) => { capturedSql = sql; return { getRowObjects: () => [], getRowObjectsJson: () => [] }; },
    };
    const reader = new DuckDBFileReader(mockConn as never, { insert: async () => 0 } as never);
    await reader.ingestGlob(['/tmp/*.jsonl'], () => null, baseCtx);
    assert.ok(!capturedSql.includes('WHERE'), 'no sinceMs should omit WHERE clause');
  });

  it('maps rows through mapRow and inserts non-null results', async () => {
    const event = makeEvent();
    const rows = [{ modelId: 'gpt-4o' }, { modelId: 'gpt-4o' }];
    let insertedEvents: UsageEvent[] = [];
    const mockWriter = { insert: async (events: UsageEvent[]) => { insertedEvents = events; return events.length; } };
    const mockConn = { runAndReadAll: async () => ({ getRowObjectsJson: () => rows }) };
    const reader = new DuckDBFileReader(mockConn as never, mockWriter as never);
    const result = await reader.ingestGlob(['/tmp/*.jsonl'], () => event, baseCtx);
    assert.equal(result.inserted, 2);
    assert.equal(insertedEvents.length, 2);
  });

  it('filters out null results from mapRow and returns 0 when all rows are null', async () => {
    const reader = makeReader([{ modelId: 'unknown' }]);
    const result = await reader.ingestGlob(['/tmp/*.jsonl'], () => null, baseCtx);
    assert.deepEqual(result, { inserted: 0, maxEventTs: null });
  });

  it('returns 0 when DuckDB throws', async () => {
    const mockConn = {
      runAndReadAll: async () => { throw new Error('DuckDB native error'); },
    };
    const reader = new DuckDBFileReader(mockConn as never, { insert: async () => 0 } as never);
    const result = await reader.ingestGlob(['/tmp/*.jsonl'], () => null, baseCtx);
    assert.deepEqual(result, { inserted: 0, maxEventTs: null });
  });

  it('reads rows via getRowObjectsJson so nested structs reach mapRow as plain objects', async () => {
    // getRowObjects() would hand back node-api wrapper values ({ entries }) that
    // mapRow cannot navigate; the ingest path must use getRowObjectsJson().
    const nestedRow = {
      type: 'assistant',
      message: { model: 'claude-opus-4-8', usage: { input_tokens: '5', output_tokens: '9' } },
      timestamp: '2026-07-04T00:00:00Z',
    };
    let usedJson = false;
    const mockConn = {
      runAndReadAll: async () => ({
        getRowObjects: () => { throw new Error('ingest must not use getRowObjects'); },
        getRowObjectsJson: () => { usedJson = true; return [nestedRow]; },
      }),
    };
    let seen: Record<string, unknown> | undefined;
    const reader = new DuckDBFileReader(mockConn as never, { insert: async (e: UsageEvent[]) => e.length } as never);
    const result = await reader.ingestGlob(['/tmp/*.jsonl'], (r) => { seen = r; return makeEvent(); }, baseCtx);
    assert.ok(usedJson, 'ingest must read rows via getRowObjectsJson');
    assert.equal(result.inserted, 1);
    assert.deepEqual(
      (seen as { message: { usage: unknown } }).message.usage,
      { input_tokens: '5', output_tokens: '9' },
    );
  });

  it('treats "No files found" as an empty result without warning', async () => {
    const warns: string[] = [];
    const logger = { warn: (_t: string, m: string) => { warns.push(m); }, debug: () => {}, info: () => {}, error: () => {} };
    const mockConn = {
      runAndReadAll: async () => { throw new Error('IO Error: No files found that match the pattern "x"'); },
    };
    const reader = new DuckDBFileReader(mockConn as never, { insert: async () => 0 } as never, logger as never);
    const result = await reader.ingestGlob(['/tmp/*.jsonl'], () => null, baseCtx);
    assert.deepEqual(result, { inserted: 0, maxEventTs: null });
    assert.equal(warns.length, 0, 'no-files is benign and must not warn');
  });

  it('escapes single quotes in glob paths', async () => {
    let capturedSql = '';
    const mockConn = {
      runAndReadAll: async (sql: string) => { capturedSql = sql; return { getRowObjects: () => [], getRowObjectsJson: () => [] }; },
    };
    const reader = new DuckDBFileReader(mockConn as never, { insert: async () => 0 } as never);
    await reader.ingestGlob(["/tmp/it's/*.jsonl"], () => null, baseCtx);
    assert.ok(capturedSql.includes("''"), 'single quotes in glob paths should be escaped');
  });

  it('passes ctx to mapRow', async () => {
    const capturedCtxs: ParseContext[] = [];
    const row = { id: 'r1' };
    const mockConn = { runAndReadAll: async () => ({ getRowObjectsJson: () => [row] }) };
    const reader = new DuckDBFileReader(mockConn as never, { insert: async (es: UsageEvent[]) => es.length } as never);
    await reader.ingestGlob(
      ['/tmp/*.jsonl'],
      (_r, ctx) => { capturedCtxs.push(ctx); return makeEvent(); },
      baseCtx,
    );
    assert.equal(capturedCtxs.length, 1);
    assert.equal(capturedCtxs[0]!.pricePerCredit, 0.04);
  });

  it('handles multiple globs in array', async () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const reader = makeReader(rows);
    const event = makeEvent();
    const result = await reader.ingestGlob(
      ['/tmp/a/*.jsonl', '/tmp/b/*.jsonl'],
      () => event,
      baseCtx,
    );
    assert.equal(result.inserted, 3);
  });
});

describe('DuckDBFileReader — hasField', () => {
  it('returns false immediately for empty globs array', async () => {
    const reader = makeReader([]);
    const result = await reader.hasField([], 'type', 'agent');
    assert.equal(result, false);
  });

  it('accepts a single string glob (not an array)', async () => {
    const rows = [{ cnt: 1 }];
    const reader = makeReader(rows);
    const result = await reader.hasField('/tmp/*.jsonl', 'type', 'agent');
    assert.equal(result, true);
  });

  it('returns true when count > 0', async () => {
    const rows = [{ cnt: 5 }];
    const reader = makeReader(rows);
    const result = await reader.hasField(['/tmp/*.jsonl'], 'type', 'agent');
    assert.equal(result, true);
  });

  it('returns false when count is 0', async () => {
    const rows = [{ cnt: 0 }];
    const reader = makeReader(rows);
    const result = await reader.hasField(['/tmp/*.jsonl'], 'type', 'agent');
    assert.equal(result, false);
  });

  it('returns false when cnt row is absent', async () => {
    const reader = makeReader([]);
    const result = await reader.hasField(['/tmp/*.jsonl'], 'type', 'agent');
    assert.equal(result, false);
  });

  it('returns false when DuckDB throws', async () => {
    const mockConn = {
      runAndReadAll: async () => { throw new Error('DuckDB native error'); },
    };
    const reader = new DuckDBFileReader(mockConn as never, { insert: async () => 0 } as never);
    const result = await reader.hasField(['/tmp/*.jsonl'], 'type', 'agent');
    assert.equal(result, false);
  });

  it('returns false without warning when DuckDB reports no files found', async () => {
    const warns: string[] = [];
    const logger = { warn: (_t: string, m: string) => { warns.push(m); }, debug: () => {}, info: () => {}, error: () => {} };
    const mockConn = {
      runAndReadAll: async () => { throw new Error('IO Error: No files found that match the pattern "x"'); },
    };
    const reader = new DuckDBFileReader(mockConn as never, { insert: async () => 0 } as never, logger as never);
    const result = await reader.hasField(['/tmp/*.jsonl'], 'type', 'agent');
    assert.equal(result, false);
    assert.equal(warns.length, 0, 'no-files is benign and must not warn');
  });

  it('uses "type" as fallback when field name contains non-alpha/underscore chars', async () => {
    let capturedSql = '';
    const mockConn = {
      runAndReadAll: async (sql: string) => { capturedSql = sql; return { getRowObjects: () => [{ cnt: 0 }] }; },
    };
    const reader = new DuckDBFileReader(mockConn as never, { insert: async () => 0 } as never);
    await reader.hasField(['/tmp/*.jsonl'], 'field with spaces', 'value');
    assert.ok(capturedSql.includes('WHERE type ='), 'unsafe field name should fall back to "type"');
  });

  it('keeps alphanumeric/underscore field names as-is', async () => {
    let capturedSql = '';
    const mockConn = {
      runAndReadAll: async (sql: string) => { capturedSql = sql; return { getRowObjects: () => [{ cnt: 0 }] }; },
    };
    const reader = new DuckDBFileReader(mockConn as never, { insert: async () => 0 } as never);
    await reader.hasField(['/tmp/*.jsonl'], 'custom_field', 'val');
    assert.ok(capturedSql.includes('WHERE custom_field ='), 'safe field name should be preserved');
  });

  it('escapes single quotes in field value', async () => {
    let capturedSql = '';
    const mockConn = {
      runAndReadAll: async (sql: string) => { capturedSql = sql; return { getRowObjects: () => [{ cnt: 0 }] }; },
    };
    const reader = new DuckDBFileReader(mockConn as never, { insert: async () => 0 } as never);
    await reader.hasField(['/tmp/*.jsonl'], 'type', "val'ue");
    assert.ok(capturedSql.includes("val''ue"), 'single quotes in value should be escaped');
  });

  it('escapes single quotes in glob paths', async () => {
    let capturedSql = '';
    const mockConn = {
      runAndReadAll: async (sql: string) => { capturedSql = sql; return { getRowObjects: () => [{ cnt: 0 }] }; },
    };
    const reader = new DuckDBFileReader(mockConn as never, { insert: async () => 0 } as never);
    await reader.hasField(["/tmp/it's/*.jsonl"], 'type', 'agent');
    assert.ok(capturedSql.includes("''"), 'single quotes in glob paths should be escaped');
  });
});

describe('DuckDBFileReader — ingestSqlite', () => {
  function makeSqliteConn(opts: { attachThrows?: boolean; queryThrows?: boolean; rows?: Record<string, unknown>[] }) {
    const calls: string[] = [];
    return {
      calls,
      run: async (sql: string) => {
        calls.push(sql);
        if (opts.attachThrows && sql.startsWith('ATTACH')) throw new Error('attach fail');
        return undefined;
      },
      runAndReadAll: async () => {
        if (opts.queryThrows) throw new Error('query fail');
        return { getRowObjectsJson: () => opts.rows ?? [] };
      },
    };
  }

  it('reads rows via getRowObjectsJson, attaches, inserts, and detaches', async () => {
    const conn = makeSqliteConn({ rows: [{ modelId: 'x' }, { modelId: 'y' }] });
    const reader = new DuckDBFileReader(conn as never, { insert: async (e: UsageEvent[]) => e.length } as never);
    const result = await reader.ingestSqlite('/db/spans.sqlite', 'SELECT * FROM mallard_otel.spans', () => makeEvent(), baseCtx);
    assert.equal(result.inserted, 2);
    assert.ok(conn.calls.some((c) => c.startsWith('ATTACH')), 'attaches the db');
    assert.ok(conn.calls.some((c) => c.startsWith('DETACH')), 'detaches after');
  });

  it('returns 0 when the attach fails', async () => {
    const conn = makeSqliteConn({ attachThrows: true });
    const reader = new DuckDBFileReader(conn as never, { insert: async () => 0 } as never);
    const result = await reader.ingestSqlite('/db/x.sqlite', 'SELECT 1', () => makeEvent(), baseCtx);
    assert.deepEqual(result, { inserted: 0, maxEventTs: null });
    assert.ok(!conn.calls.some((c) => c.startsWith('DETACH')), 'no detach when attach failed');
  });

  it('returns 0 and still detaches when the query fails', async () => {
    const conn = makeSqliteConn({ queryThrows: true });
    const reader = new DuckDBFileReader(conn as never, { insert: async () => 0 } as never);
    const result = await reader.ingestSqlite('/db/x.sqlite', 'SELECT 1', () => makeEvent(), baseCtx);
    assert.deepEqual(result, { inserted: 0, maxEventTs: null });
    assert.ok(conn.calls.some((c) => c.startsWith('DETACH')), 'detach runs in finally');
  });

  it('returns 0 when the query yields no rows', async () => {
    const conn = makeSqliteConn({ rows: [] });
    const reader = new DuckDBFileReader(conn as never, { insert: async () => 0 } as never);
    const result = await reader.ingestSqlite('/db/x.sqlite', 'SELECT 1', () => makeEvent(), baseCtx);
    assert.deepEqual(result, { inserted: 0, maxEventTs: null });
  });
});
