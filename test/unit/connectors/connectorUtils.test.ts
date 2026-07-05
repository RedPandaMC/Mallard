import { strict as assert } from 'assert';
import {
  num,
  pick,
  toSurface,
  fileKeyOf,
  parseTimestamp,
  flattenOtelAttributes,
  splitCostSimple,
  splitCostByBreakdown,
} from '../../../src/extension-backend/ingest/connectorUtils';

describe('connectorUtils', () => {
  describe('parseTimestamp() — OTel nanoseconds', () => {
    it('falls back to startTimeUnixNano (ns → ms)', () => {
      assert.equal(parseTimestamp({ startTimeUnixNano: 1_700_000_000_000_000_000 }), 1_700_000_000_000);
    });
    it('accepts a string nanosecond value', () => {
      assert.equal(parseTimestamp({ timeUnixNano: '1700000000000000000' }), 1_700_000_000_000);
    });
    it('returns undefined when no timestamp of any kind is present', () => {
      assert.equal(parseTimestamp({ foo: 'bar' }), undefined);
      assert.equal(parseTimestamp({ startTimeUnixNano: {} }), undefined);
    });
  });

  describe('flattenOtelAttributes()', () => {
    it('flattens an OTLP {key,value} array, unwrapping typed values', () => {
      const out = flattenOtelAttributes([
        { key: 'gen_ai.request.model', value: { stringValue: 'gpt-4o' } },
        { key: 'gen_ai.usage.input_tokens', value: { intValue: 100 } },
        { key: 'flag', value: { boolValue: true } },
        { key: 'raw', value: 42 },
        { notAKey: true },
      ]);
      assert.equal(out['gen_ai.request.model'], 'gpt-4o');
      assert.equal(out['gen_ai.usage.input_tokens'], 100);
      assert.equal(out['flag'], true);
      assert.equal(out['raw'], 42);
    });
    it('returns a plain object map as-is, and {} for non-objects', () => {
      const obj = { 'gen_ai.request.model': 'gpt-4o' };
      assert.equal(flattenOtelAttributes(obj), obj);
      assert.deepEqual(flattenOtelAttributes(undefined), {});
      assert.deepEqual(flattenOtelAttributes('nope'), {});
    });
  });
  // ── num ──────────────────────────────────────────────────────────────────────

  describe('num()', () => {
    it('parses positive integers', () => {
      assert.equal(num(42), 42);
      assert.equal(num('42'), 42);
    });

    it('parses zero', () => {
      assert.equal(num(0), 0);
      assert.equal(num('0'), 0);
    });

    it('parses floating-point values', () => {
      assert.equal(num(1.5), 1.5);
      assert.equal(num('1.5'), 1.5);
    });

    it('returns undefined for negative values', () => {
      assert.equal(num(-1), undefined);
      assert.equal(num('-5'), undefined);
    });

    it('returns undefined for NaN-producing inputs', () => {
      assert.equal(num('abc'), undefined);
      assert.equal(num(NaN), undefined);
    });

    it('returns undefined for null/undefined/boolean', () => {
      assert.equal(num(null), undefined);
      assert.equal(num(undefined), undefined);
      assert.equal(num(true), undefined);
    });
  });

  // ── pick ─────────────────────────────────────────────────────────────────────

  describe('pick()', () => {
    it('returns the first non-null matching value', () => {
      assert.equal(pick({ a: 1, b: 2 }, ['a', 'b']), 1);
    });

    it('skips null and undefined values and returns the next match', () => {
      assert.equal(pick({ a: null, b: undefined, c: 3 }, ['a', 'b', 'c']), 3);
    });

    it('returns undefined when no key matches', () => {
      assert.equal(pick({ a: 1 }, ['x', 'y']), undefined);
    });

    it('returns false and 0 (falsy but not null)', () => {
      assert.equal(pick({ a: false }, ['a']), false);
      assert.equal(pick({ a: 0 }, ['a']), 0);
    });
  });

  // ── toSurface ────────────────────────────────────────────────────────────────

  describe('toSurface()', () => {
    it('maps inline and completion variants', () => {
      assert.equal(toSurface('inline'), 'inline');
      assert.equal(toSurface('completion'), 'inline');
      assert.equal(toSurface('INLINE'), 'inline');
    });

    it('maps agent', () => {
      assert.equal(toSurface('agent'), 'agent');
      assert.equal(toSurface('Agent'), 'agent');
    });

    it('maps edit', () => {
      assert.equal(toSurface('edit'), 'edit');
    });

    it('maps chat', () => {
      assert.equal(toSurface('chat'), 'chat');
    });

    it('returns unknown for unrecognized values', () => {
      assert.equal(toSurface('panel'), 'unknown');
      assert.equal(toSurface(''), 'unknown');
      assert.equal(toSurface(null), 'unknown');
      assert.equal(toSurface(undefined), 'unknown');
    });
  });

  // ── fileKeyOf ────────────────────────────────────────────────────────────────

  describe('fileKeyOf()', () => {
    it('returns a non-empty string', () => {
      assert.ok(fileKeyOf('/some/path/file.jsonl').length > 0);
    });

    it('is deterministic for the same input', () => {
      const path = '/home/user/.config/copilot/logs/session.jsonl';
      assert.equal(fileKeyOf(path), fileKeyOf(path));
    });

    it('produces different keys for different paths', () => {
      assert.notEqual(fileKeyOf('/path/a.jsonl'), fileKeyOf('/path/b.jsonl'));
    });

    it('handles empty string without throwing', () => {
      assert.ok(typeof fileKeyOf('') === 'string');
    });
  });

  // ── parseTimestamp ───────────────────────────────────────────────────────────

  describe('parseTimestamp()', () => {
    it('parses ISO string from timestamp key', () => {
      const ts = parseTimestamp({ timestamp: '2024-01-15T12:00:00.000Z' });
      assert.equal(ts, Date.parse('2024-01-15T12:00:00.000Z'));
    });

    it('parses ISO string from time key', () => {
      const ts = parseTimestamp({ time: '2024-06-01T00:00:00Z' });
      assert.equal(ts, Date.parse('2024-06-01T00:00:00Z'));
    });

    it('uses numeric value directly', () => {
      assert.equal(parseTimestamp({ timestamp: 1_234_567_890 }), 1_234_567_890);
    });

    it('prefers timestamp over time', () => {
      const ts = parseTimestamp({ timestamp: '2024-01-01T00:00:00Z', time: '2024-06-01T00:00:00Z' });
      assert.equal(ts, Date.parse('2024-01-01T00:00:00Z'));
    });

    it('returns undefined for missing keys (callers must skip the row)', () => {
      assert.equal(parseTimestamp({}), undefined);
    });

    it('returns undefined for invalid string', () => {
      assert.equal(parseTimestamp({ timestamp: 'not-a-date' }), undefined);
    });
  });

  // ── splitCostSimple ──────────────────────────────────────────────────────────

  describe('splitCostSimple()', () => {
    it('splits cost proportionally between input and output', () => {
      const result = splitCostSimple(1.0, 500, 1000);
      assert.ok(Math.abs((result.input ?? 0) - 0.5) < 1e-9);
      assert.ok(Math.abs((result.output ?? 0) - 0.5) < 1e-9);
    });

    it('returns only input when all tokens are prompt tokens', () => {
      const result = splitCostSimple(1.0, 1000, 1000);
      assert.ok((result.input ?? 0) > 0);
      assert.equal(result.output, undefined);
    });

    it('returns only output when prompt tokens are zero', () => {
      const result = splitCostSimple(1.0, 0, 1000);
      assert.equal(result.input, undefined);
      assert.ok((result.output ?? 0) > 0);
    });

    it('returns empty object when total tokens is zero', () => {
      assert.deepEqual(splitCostSimple(1.0, 0, 0), {});
    });

    it('returns empty object when cost is zero', () => {
      const result = splitCostSimple(0, 500, 1000);
      assert.equal(result.input, undefined);
      assert.equal(result.output, undefined);
    });
  });

  // ── splitCostByBreakdown ─────────────────────────────────────────────────────

  describe('splitCostByBreakdown()', () => {
    it('splits across all five categories proportionally', () => {
      const tokens = { prompt: 100, completion: 100, cacheCreation: 100, cacheRead: 100, thinking: 100 };
      const result = splitCostByBreakdown(5.0, tokens);
      assert.ok(Math.abs((result.input ?? 0) - 1.0) < 1e-9);
      assert.ok(Math.abs((result.output ?? 0) - 1.0) < 1e-9);
      assert.ok(Math.abs((result.cache_creation ?? 0) - 1.0) < 1e-9);
      assert.ok(Math.abs((result.cache_read ?? 0) - 1.0) < 1e-9);
      assert.ok(Math.abs((result.thinking ?? 0) - 1.0) < 1e-9);
    });

    it('omits categories with zero tokens', () => {
      const result = splitCostByBreakdown(1.0, { prompt: 500, completion: 500 });
      assert.ok(result.input !== undefined);
      assert.ok(result.output !== undefined);
      assert.equal(result.cache_creation, undefined);
      assert.equal(result.cache_read, undefined);
      assert.equal(result.thinking, undefined);
    });

    it('returns empty object when all tokens are zero', () => {
      assert.deepEqual(splitCostByBreakdown(1.0, {}), {});
    });

    it('handles single-category breakdown', () => {
      const result = splitCostByBreakdown(2.0, { thinking: 1000 });
      assert.ok(Math.abs((result.thinking ?? 0) - 2.0) < 1e-9);
      assert.equal(result.input, undefined);
    });
  });
});
