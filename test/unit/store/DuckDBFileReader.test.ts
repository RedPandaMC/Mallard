import { strict as assert } from 'assert';
import { DuckDBFileReader } from '../../../src/store/DuckDBFileReader';
import type { UsageEvent } from '../../../src/domain/types';
import type { ParseContext } from '../../../src/ingest/otelParse';

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
    runAndReadAll: async () => ({ getRowObjects: () => rows }),
  };
  const mockWriter = { insert: insertFn ?? (async (events: UsageEvent[]) => events.length) };
  return new DuckDBFileReader(mockConn as never, mockWriter as never);
}

describe('DuckDBFileReader — ingestGlob', () => {
  it('returns 0 immediately for empty globs array', async () => {
    const reader = makeReader([]);
    const result = await reader.ingestGlob([], () => null, baseCtx);
    assert.equal(result, 0);
  });

  it('accepts a single string glob (not an array)', async () => {
    const event = makeEvent();
    const reader = makeReader([{ modelId: 'gpt-4o' }]);
    const result = await reader.ingestGlob('/tmp/*.jsonl', () => event, baseCtx);
    assert.equal(result, 1);
  });

  it('includes WHERE clause when sinceMs is provided', async () => {
    let capturedSql = '';
    const mockConn = {
      runAndReadAll: async (sql: string) => { capturedSql = sql; return { getRowObjects: () => [] }; },
    };
    const reader = new DuckDBFileReader(mockConn as never, { insert: async () => 0 } as never);
    await reader.ingestGlob(['/tmp/*.jsonl'], () => null, baseCtx, 1_700_000_000_000);
    assert.ok(capturedSql.includes('WHERE'), 'sinceMs filter should add a WHERE clause');
    assert.ok(capturedSql.includes('1700000000000'));
  });

  it('omits WHERE clause when sinceMs is undefined', async () => {
    let capturedSql = '';
    const mockConn = {
      runAndReadAll: async (sql: string) => { capturedSql = sql; return { getRowObjects: () => [] }; },
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
    const mockConn = { runAndReadAll: async () => ({ getRowObjects: () => rows }) };
    const reader = new DuckDBFileReader(mockConn as never, mockWriter as never);
    const result = await reader.ingestGlob(['/tmp/*.jsonl'], () => event, baseCtx);
    assert.equal(result, 2);
    assert.equal(insertedEvents.length, 2);
  });

  it('filters out null results from mapRow and returns 0 when all rows are null', async () => {
    const reader = makeReader([{ modelId: 'unknown' }]);
    const result = await reader.ingestGlob(['/tmp/*.jsonl'], () => null, baseCtx);
    assert.equal(result, 0);
  });

  it('returns 0 when DuckDB throws', async () => {
    const mockConn = {
      runAndReadAll: async () => { throw new Error('DuckDB native error'); },
    };
    const reader = new DuckDBFileReader(mockConn as never, { insert: async () => 0 } as never);
    const result = await reader.ingestGlob(['/tmp/*.jsonl'], () => null, baseCtx);
    assert.equal(result, 0);
  });

  it('escapes single quotes in glob paths', async () => {
    let capturedSql = '';
    const mockConn = {
      runAndReadAll: async (sql: string) => { capturedSql = sql; return { getRowObjects: () => [] }; },
    };
    const reader = new DuckDBFileReader(mockConn as never, { insert: async () => 0 } as never);
    await reader.ingestGlob(["/tmp/it's/*.jsonl"], () => null, baseCtx);
    assert.ok(capturedSql.includes("''"), 'single quotes in glob paths should be escaped');
  });

  it('passes ctx to mapRow', async () => {
    const capturedCtxs: ParseContext[] = [];
    const row = { id: 'r1' };
    const mockConn = { runAndReadAll: async () => ({ getRowObjects: () => [row] }) };
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
    assert.equal(result, 3);
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
