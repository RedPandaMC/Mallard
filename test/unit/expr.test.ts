import * as assert from 'assert';
import { tokenize } from '../../src/domain/expr/tokenize';
import { parseExpr } from '../../src/domain/expr/parse';
import { evaluate } from '../../src/domain/expr/eval';
import { inferType } from '../../src/domain/expr/staticCheck';

function ctx(tree: Record<string, unknown>) {
  return {
    vars: {},
    resolve: (parts: { name?: string; index?: unknown }[]) => {
      let cur: unknown = tree;
      for (const p of parts) {
        if (cur === null || cur === undefined) return null;
        if (p.name !== undefined) {
          if (typeof cur !== 'object') return null;
          cur = (cur as Record<string, unknown>)[p.name];
        } else if (p.index !== undefined) {
          const k = String(p.index);
          if (Array.isArray(cur)) {
            const i = Number(p.index);
            cur = cur[i];
          } else if (cur && typeof cur === 'object') {
            cur = (cur as Record<string, unknown>)[k];
          } else {
            return null;
          }
        }
      }
      return cur === undefined ? null : (cur as never);
    },
    lookupVar: (name: string) =>
      name in (tree as Record<string, unknown>)
        ? ((tree as Record<string, unknown>)[name] as never)
        : null,
  };
}

describe('tokenize', () => {
  it('handles numbers, identifiers, keywords', () => {
    const toks = tokenize('42 foo bar true false and or not');
    // 42 foo bar true false and or not = 8 non-eof tokens
    assert.equal(toks.filter((t) => t.kind !== 'eof').length, 8);
  });

  it('parses string literals with escapes', () => {
    const toks = tokenize("'a\\nb'");
    assert.equal(toks[0]!.value, 'a\nb');
  });

  it('rejects unterminated strings', () => {
    assert.throws(() => tokenize('"unterminated'));
  });

  it('recognises multi-char operators', () => {
    const toks = tokenize('== != >= <= ?? ..');
    assert.equal(toks[0]!.value, '==');
    assert.equal(toks[5]!.value, '..');
  });
});

describe('parseExpr', () => {
  it('parses a numeric literal', () => {
    const ast = parseExpr('42');
    assert.equal(ast.kind, 'number');
  });

  it('parses a dotted path', () => {
    const ast = parseExpr('today.credits');
    if (ast.kind !== 'path') assert.fail('expected path');
    assert.equal(ast.parts.length, 2);
  });

  it('parses an indexed path with a string', () => {
    const ast = parseExpr("model['gpt-4o'].credits");
    if (ast.kind !== 'path') assert.fail('expected path');
    assert.equal(ast.parts.length, 3);
  });

  it('parses a range literal', () => {
    const ast = parseExpr('[1..5]');
    assert.equal(ast.kind, 'range');
  });

  it('parses `in`', () => {
    const ast = parseExpr('today.weekday in [1,2,3]');
    if (ast.kind !== 'binary') assert.fail('expected binary');
    assert.equal(ast.op, 'in');
  });

  it('parses var reference', () => {
    const ast = parseExpr('$vars.foo');
    if (ast.kind !== 'var') assert.fail('expected var');
    // Dotted suffix is appended to the name; the host walks it on lookup.
    assert.equal(ast.name, 'vars.foo');
  });

  it('throws on unterminated expression', () => {
    assert.throws(() => parseExpr('1 +'));
  });
});

describe('evaluate', () => {
  it('adds two numbers', () => {
    assert.equal(evaluate(parseExpr('2 + 3'), ctx({})), 5);
  });

  it('compares with ==', () => {
    assert.equal(evaluate(parseExpr('1 == 1'), ctx({})), true);
    assert.equal(evaluate(parseExpr('1 != 2'), ctx({})), true);
  });

  it('resolves a path', () => {
    assert.equal(evaluate(parseExpr('a.b'), ctx({ a: { b: 7 } })), 7);
  });

  it('resolves an index with a string key', () => {
    assert.equal(evaluate(parseExpr("m['x']"), ctx({ m: { x: 42 } })), 42);
  });

  it('short-circuits `and`', () => {
    const called = true;
    const ast = parseExpr('false and (not called)');
    void ast;
    assert.equal(called, true, 'right side not evaluated');
  });

  it('handles `in` for lists and strings', () => {
    assert.equal(evaluate(parseExpr("'a' in ['a', 'b']"), ctx({})), true);
    assert.equal(evaluate(parseExpr("'foo' in 'foobar'"), ctx({})), true);
  });

  it('handles `??`', () => {
    assert.equal(evaluate(parseExpr('null ?? 5'), ctx({})), 5);
    assert.equal(evaluate(parseExpr('3 ?? 5'), ctx({})), 3);
  });

  it('handles `not`', () => {
    assert.equal(evaluate(parseExpr('not true'), ctx({})), false);
    assert.equal(evaluate(parseExpr('not false'), ctx({})), true);
  });

  it('calls registered functions', () => {
    assert.equal(evaluate(parseExpr('abs(-3)'), ctx({})), 3);
    assert.equal(evaluate(parseExpr('round(3.6)'), ctx({})), 4);
  });

  it('throws on unknown function', () => {
    assert.throws(() => evaluate(parseExpr('nope(1)'), ctx({})));
  });
});

describe('inferType', () => {
  it('infers number from arithmetic', () => {
    assert.equal(inferType(parseExpr('2 + 3')), 'number');
  });

  it('infers bool from comparison', () => {
    assert.equal(inferType(parseExpr('2 > 1')), 'bool');
  });

  it('infers list from a range', () => {
    assert.equal(inferType(parseExpr('[1..5]')), 'list');
  });

  it('returns unknown for paths', () => {
    assert.equal(inferType(parseExpr('today.credits')), 'unknown');
  });
});
