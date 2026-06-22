import { strict as assert } from 'assert';
import { num, fileKeyOf, splitCost, toSurface } from '../../../src/ingest/parsers/parserUtils';

// ── num ───────────────────────────────────────────────────────────────────────

describe('num', () => {
  it('valid JS number → returns it', () => {
    assert.equal(num(42), 42);
    assert.equal(num(0), 0);
    assert.equal(num(3.14), 3.14);
  });

  it('numeric string → returns parsed number', () => {
    assert.equal(num('100'), 100);
    assert.equal(num('0'), 0);
  });

  it('NaN string → returns undefined', () => {
    assert.equal(num('abc'), undefined);
    assert.equal(num('NaN'), undefined);
  });

  it('undefined → returns undefined', () => {
    assert.equal(num(undefined), undefined);
  });

  it('object → returns undefined', () => {
    assert.equal(num({}), undefined);
    assert.equal(num([]), undefined);
  });

  it('negative number → returns undefined', () => {
    assert.equal(num(-1), undefined);
  });
});

// ── fileKeyOf ─────────────────────────────────────────────────────────────────

describe('fileKeyOf', () => {
  it('same path → same key', () => {
    assert.equal(fileKeyOf('/home/user/.vscode/logs/copilot.log'), fileKeyOf('/home/user/.vscode/logs/copilot.log'));
  });

  it('different paths → different keys', () => {
    assert.notEqual(fileKeyOf('/path/a.log'), fileKeyOf('/path/b.log'));
  });

  it('key is a non-empty string', () => {
    const key = fileKeyOf('/some/path/to/file.log');
    assert.equal(typeof key, 'string');
    assert.ok(key.length > 0);
  });

  it('empty string → stable key', () => {
    assert.equal(fileKeyOf(''), fileKeyOf(''));
  });
});

// ── splitCost ─────────────────────────────────────────────────────────────────

describe('splitCost', () => {
  it('zero total tokens → returns empty object', () => {
    const result = splitCost(1.0, {});
    assert.deepEqual(result, {});
  });

  it('prompt-only → only input key', () => {
    const result = splitCost(1.0, { prompt: 100 });
    assert.ok('input' in result);
    assert.ok(!('output' in result));
    assert.ok(Math.abs((result.input ?? 0) - 1.0) < 0.0001);
  });

  it('completion-only → only output key', () => {
    const result = splitCost(1.0, { completion: 50 });
    assert.ok('output' in result);
    assert.ok(!('input' in result));
  });

  it('distributes cost proportionally across token categories', () => {
    const result = splitCost(2.0, { prompt: 100, completion: 100 });
    assert.ok(Math.abs((result.input ?? 0) - 1.0) < 0.0001);
    assert.ok(Math.abs((result.output ?? 0) - 1.0) < 0.0001);
  });

  it('handles cache tokens', () => {
    const result = splitCost(4.0, { prompt: 100, completion: 100, cacheCreation: 100, cacheRead: 100 });
    assert.ok('cache_creation' in result);
    assert.ok('cache_read' in result);
    assert.ok(Math.abs((result.cache_creation ?? 0) - 1.0) < 0.0001);
  });

  it('handles thinking tokens', () => {
    const result = splitCost(2.0, { prompt: 100, thinking: 100 });
    assert.ok('thinking' in result);
    assert.ok(Math.abs((result.thinking ?? 0) - 1.0) < 0.0001);
  });

  it('zero cost → all zeros (or not present)', () => {
    const result = splitCost(0, { prompt: 100, completion: 100 });
    assert.ok(!result.input || result.input === 0);
    assert.ok(!result.output || result.output === 0);
  });
});

// ── toSurface ─────────────────────────────────────────────────────────────────

describe('toSurface', () => {
  it('"inline" string → "inline"', () => {
    assert.equal(toSurface('inline'), 'inline');
    assert.equal(toSurface('INLINE_COMPLETION'), 'inline');
    assert.equal(toSurface('completion'), 'inline');
  });

  it('"agent" string → "agent"', () => {
    assert.equal(toSurface('agent'), 'agent');
    assert.equal(toSurface('AGENT'), 'agent');
    assert.equal(toSurface('invoke_agent'), 'agent');
  });

  it('"edit" string → "edit"', () => {
    assert.equal(toSurface('edit'), 'edit');
    assert.equal(toSurface('EDIT'), 'edit');
  });

  it('"chat" string → "chat"', () => {
    assert.equal(toSurface('chat'), 'chat');
    assert.equal(toSurface('CHAT'), 'chat');
  });

  it('unknown string → "unknown"', () => {
    assert.equal(toSurface('something_random'), 'unknown');
    assert.equal(toSurface(''), 'unknown');
    assert.equal(toSurface(undefined), 'unknown');
    assert.equal(toSurface(null), 'unknown');
  });
});
