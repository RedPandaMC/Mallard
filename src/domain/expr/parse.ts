/**
 * Pratt parser for the alert-rule expression language.
 * Pure: no I/O, no globals. `parse` throws on a syntax error.
 */
import { BinaryOp, Expr, ExprEvalError, PathPart, UnaryOp } from './ast';
import { Token, tokenize } from './tokenize';

interface Parser {
  tokens: Token[];
  pos: number;
}

function peek(p: Parser): Token {
  return p.tokens[p.pos]!;
}

function advance(p: Parser): Token {
  const t = p.tokens[p.pos]!;
  p.pos++;
  return t;
}

function isKeyword(t: Token, k: string): boolean {
  return t.kind === 'keyword' && t.value === k;
}

function expectPunct(p: Parser, ch: string): Token {
  const t = peek(p);
  if (t.kind !== 'punct' || t.value !== ch) {
    throw new ExprEvalError({ message: `Expected '${ch}'`, pointer: String(t.start) });
  }
  return advance(p);
}

export function parseExpr(input: string): Expr {
  const p: Parser = { tokens: tokenize(input), pos: 0 };
  const e = parseOr(p);
  if (peek(p).kind !== 'eof') {
    throw new ExprEvalError({ message: 'Unexpected token', pointer: String(peek(p).start) });
  }
  return e;
}

function parseOr(p: Parser): Expr {
  let left = parseAnd(p);
  while (isKeyword(peek(p), 'or')) {
    advance(p);
    const right = parseAnd(p);
    left = { kind: 'binary', op: 'or', left, right };
  }
  return left;
}

function parseAnd(p: Parser): Expr {
  let left = parseNot(p);
  while (isKeyword(peek(p), 'and')) {
    advance(p);
    const right = parseNot(p);
    left = { kind: 'binary', op: 'and', left, right };
  }
  return left;
}

function parseNot(p: Parser): Expr {
  if (isKeyword(peek(p), 'not')) {
    advance(p);
    return { kind: 'unary', op: 'not', arg: parseNot(p) };
  }
  return parseCmp(p);
}

function parseCmp(p: Parser): Expr {
  let left = parseAdd(p);
  while (true) {
    const t = peek(p);
    if (t.kind === 'op' && ['==', '!=', '>', '>=', '<', '<='].includes(t.value)) {
      const op = advance(p).value as BinaryOp;
      const right = parseAdd(p);
      left = { kind: 'binary', op, left, right };
    } else if (t.kind === 'op' && t.value === '??') {
      advance(p);
      const right = parseAdd(p);
      left = { kind: 'binary', op: '??', left, right };
    } else if (isKeyword(t, 'in')) {
      advance(p);
      const right = parseAdd(p);
      left = { kind: 'binary', op: 'in', left, right };
    } else if (isKeyword(t, 'contains')) {
      advance(p);
      const right = parseAdd(p);
      left = { kind: 'binary', op: 'contains', left, right };
    } else if (isKeyword(t, 'startsWith')) {
      advance(p);
      const right = parseAdd(p);
      left = { kind: 'binary', op: 'startsWith', left, right };
    } else if (isKeyword(t, 'endsWith')) {
      advance(p);
      const right = parseAdd(p);
      left = { kind: 'binary', op: 'endsWith', left, right };
    } else {
      break;
    }
  }
  return left;
}

function parseAdd(p: Parser): Expr {
  let left = parseMul(p);
  while (peek(p).kind === 'op' && (peek(p).value === '+' || peek(p).value === '-')) {
    const op = advance(p).value as BinaryOp;
    const right = parseMul(p);
    left = { kind: 'binary', op, left, right };
  }
  return left;
}

function parseMul(p: Parser): Expr {
  let left = parseUnary(p);
  while (peek(p).kind === 'op' && ['*', '/', '%'].includes(peek(p).value)) {
    const op = advance(p).value as BinaryOp;
    const right = parseUnary(p);
    left = { kind: 'binary', op, left, right };
  }
  return left;
}

function parseUnary(p: Parser): Expr {
  const t = peek(p);
  if (t.kind === 'op' && t.value === '-') {
    advance(p);
    return { kind: 'unary', op: '-' as UnaryOp, arg: parseUnary(p) };
  }
  return parsePrimary(p);
}

function parsePrimary(p: Parser): Expr {
  const t = peek(p);

  if (t.kind === 'number') {
    advance(p);
    const raw = t.value;
    if (/[mhdw]$/.test(raw)) {
      return { kind: 'string', value: raw };
    }
    return { kind: 'number', value: Number(raw) };
  }
  if (t.kind === 'string') {
    advance(p);
    return { kind: 'string', value: t.value };
  }
  if (isKeyword(t, 'true')) {
    advance(p);
    return { kind: 'bool', value: true };
  }
  if (isKeyword(t, 'false')) {
    advance(p);
    return { kind: 'bool', value: false };
  }
  if (isKeyword(t, 'null')) {
    advance(p);
    return { kind: 'null' };
  }
  if (t.kind === 'punct' && t.value === '(') {
    advance(p);
    const e = parseOr(p);
    expectPunct(p, ')');
    return e;
  }
  if (t.kind === 'punct' && t.value === '[') {
    advance(p);
    if (peek(p).kind === 'punct' && peek(p).value === ']') {
      advance(p);
      return { kind: 'list', items: [] };
    }
    const first = parseOr(p);
    if (peek(p).kind === 'op' && peek(p).value === '..') {
      advance(p);
      const end = parseOr(p);
      expectPunct(p, ']');
      return { kind: 'range', start: first, end };
    }
    const items: Expr[] = [first];
    while (peek(p).kind === 'punct' && peek(p).value === ',') {
      advance(p);
      items.push(parseOr(p));
    }
    expectPunct(p, ']');
    return { kind: 'list', items };
  }
  if (t.kind === 'punct' && t.value === '$') {
    advance(p);
    const id = peek(p);
    if (id.kind !== 'ident') {
      throw new ExprEvalError({
        message: 'Expected variable name after $',
        pointer: String(id.start),
      });
    }
    advance(p);
    // Allow dotted access on a var: $vars.foo.bar — encoded into the name
    // as a dot-separated string. The host's EvalContext.lookupVar treats
    // dots as nested object access.
    let name = id.value;
    while (peek(p).kind === 'punct' && peek(p).value === '.') {
      advance(p);
      const f = peek(p);
      if (f.kind !== 'ident') {
        throw new ExprEvalError({
          message: 'Expected identifier after .',
          pointer: String(f.start),
        });
      }
      advance(p);
      name += '.' + f.value;
    }
    return { kind: 'var', name };
  }
  if (t.kind === 'ident') {
    const id = advance(p);
    // function call
    if (peek(p).kind === 'punct' && peek(p).value === '(') {
      advance(p);
      const args: Expr[] = [];
      if (!(peek(p).kind === 'punct' && peek(p).value === ')')) {
        args.push(parseOr(p));
        while (peek(p).kind === 'punct' && peek(p).value === ',') {
          advance(p);
          args.push(parseOr(p));
        }
      }
      expectPunct(p, ')');
      return { kind: 'call', name: id.value, args };
    }
    // path
    const parts: PathPart[] = [{ kind: 'ident', name: id.value }];
    while (true) {
      const nx = peek(p);
      if (nx.kind === 'punct' && nx.value === '.') {
        advance(p);
        const f = peek(p);
        if (f.kind !== 'ident') {
          throw new ExprEvalError({
            message: 'Expected identifier after .',
            pointer: String(f.start),
          });
        }
        advance(p);
        parts.push({ kind: 'ident', name: f.value });
      } else if (nx.kind === 'punct' && nx.value === '[') {
        advance(p);
        const idx = parseOr(p);
        expectPunct(p, ']');
        parts.push({ kind: 'index', index: idx });
      } else {
        break;
      }
    }
    return { kind: 'path', parts };
  }

  throw new ExprEvalError({
    message: `Unexpected token '${t.text || t.value}'`,
    pointer: String(t.start),
  });
}
