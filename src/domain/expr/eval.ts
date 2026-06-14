/**
 * Walks the AST against an evaluation context. Throws `ExprEvalError` on
 * type errors, missing paths, or function errors.
 */
import { Expr, ExprEvalError, Value } from './ast';
import { getFunction } from './functions';

export interface EvalContext {
  vars: Record<string, Value>;
  /** Resolve a dotted/indexed path against the context object. */
  resolve(pathParts: { name?: string; index?: Value }[]): Value;
  /** Look up a variable by name (already resolved from `$vars.foo`). */
  lookupVar(name: string): Value;
  /** Optional side-tables the host exposes (e.g. function-specific data). */
  data?: Record<string, Value>;
}

function isTruthy(v: Value): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

function toNumber(v: Value, op: string): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  throw new ExprEvalError({ message: `Operator '${op}' requires a number; got ${describe(v)}` });
}

function describe(v: Value): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'list';
  return typeof v;
}

function evalRangeList(start: Value, end: Value): Value[] {
  const s = toNumber(start, 'range');
  const e = toNumber(end, 'range');
  if (!Number.isInteger(s) || !Number.isInteger(e)) {
    throw new ExprEvalError({ message: 'Range bounds must be integers' });
  }
  if (e < s) {
    throw new ExprEvalError({ message: 'Range end must be ≥ start' });
  }
  const out: number[] = [];
  for (let i = s; i <= e; i++) out.push(i);
  return out;
}

export function evaluate(expr: Expr, ctx: EvalContext): Value {
  switch (expr.kind) {
    case 'number':
    case 'string':
    case 'bool':
      return expr.value;
    case 'null':
      return null;
    case 'path': {
      const parts: { name?: string; index?: Value }[] = [];
      for (const p of expr.parts) {
        if (p.kind === 'ident') {
          parts.push({ name: p.name });
        } else {
          parts.push({ index: evaluate(p.index, ctx) });
        }
      }
      return ctx.resolve(parts);
    }
    case 'index': {
      const base = evaluate(expr.base, ctx);
      const key = evaluate(expr.key, ctx);
      if (Array.isArray(base)) {
        const i = toNumber(key, 'index');
        const idx = i < 0 ? base.length + i : i;
        return base[idx] ?? null;
      }
      if (base && typeof base === 'object') {
        return (base as Record<string, Value>)[String(key)] ?? null;
      }
      throw new ExprEvalError({ message: `Cannot index into ${describe(base)}` });
    }
    case 'var': {
      // Support dotted names: $vars.foo.bar walks the vars object.
      const parts = expr.name.split('.');
      let cur: Value = ctx.lookupVar(parts[0]!);
      for (let i = 1; i < parts.length; i++) {
        if (cur === null || cur === undefined) return null;
        if (typeof cur !== 'object' || Array.isArray(cur)) {
          throw new ExprEvalError({ message: `Cannot access '${parts[i]}' on ${describe(cur)}` });
        }
        cur = (cur as Record<string, Value>)[parts[i]!] ?? null;
      }
      return cur;
    }
    case 'list': {
      const out: Value[] = [];
      for (const item of expr.items) out.push(evaluate(item, ctx));
      return out;
    }
    case 'range': {
      const s = evaluate(expr.start, ctx);
      const e = evaluate(expr.end, ctx);
      return evalRangeList(s, e);
    }
    case 'unary': {
      const v = evaluate(expr.arg, ctx);
      if (expr.op === '-') return -toNumber(v, 'unary -');
      if (expr.op === 'not') return !isTruthy(v);
      throw new ExprEvalError({ message: `Unknown unary op '${expr.op}'` });
    }
    case 'binary': {
      // Short-circuit 'and' / 'or'
      if (expr.op === 'and') {
        const l = evaluate(expr.left, ctx);
        return isTruthy(l) ? isTruthy(evaluate(expr.right, ctx)) : false;
      }
      if (expr.op === 'or') {
        const l = evaluate(expr.left, ctx);
        return isTruthy(l) ? true : isTruthy(evaluate(expr.right, ctx));
      }
      const l = evaluate(expr.left, ctx);
      const r = evaluate(expr.right, ctx);
      return applyBinary(expr.op, l, r, ctx);
    }
    case 'call': {
      const args = expr.args.map((a) => evaluate(a, ctx));
      const spec = getFunction(expr.name);
      if (!spec) {
        throw new ExprEvalError({ message: `Unknown function '${expr.name}'` });
      }
      if (args.length < spec.minArity || (spec.maxArity >= 0 && args.length > spec.maxArity)) {
        throw new ExprEvalError({
          message: `Function '${expr.name}' expects ${arityText(spec)} args, got ${args.length}`,
        });
      }
      return spec.impl(args, { vars: ctx.vars });
    }
  }
}

function arityText(spec: { minArity: number; maxArity: number }): string {
  if (spec.maxArity < 0) return `${spec.minArity}+`;
  if (spec.minArity === spec.maxArity) return String(spec.minArity);
  return `${spec.minArity}..${spec.maxArity}`;
}

function applyBinary(op: string, l: Value, r: Value, _ctx: EvalContext): Value {
  switch (op) {
    case '+':
      if (typeof l === 'string' || typeof r === 'string') return String(l ?? '') + String(r ?? '');
      return toNumber(l, '+') + toNumber(r, '+');
    case '-':
      return toNumber(l, '-') - toNumber(r, '-');
    case '*':
      return toNumber(l, '*') * toNumber(r, '*');
    case '/': {
      const d = toNumber(r, '/');
      if (d === 0) throw new ExprEvalError({ message: 'Division by zero' });
      return toNumber(l, '/') / d;
    }
    case '%':
      return toNumber(l, '%') % toNumber(r, '%');
    case '==':
      return looseEq(l, r);
    case '!=':
      return !looseEq(l, r);
    case '>':
      return cmp(l, r) > 0;
    case '>=':
      return cmp(l, r) >= 0;
    case '<':
      return cmp(l, r) < 0;
    case '<=':
      return cmp(l, r) <= 0;
    case '??':
      return l === null || l === undefined ? r : l;
    case 'in': {
      if (Array.isArray(r)) {
        for (const x of r) if (looseEq(x, l)) return true;
        return false;
      }
      if (typeof r === 'string' && typeof l === 'string') {
        return r.includes(l);
      }
      throw new ExprEvalError({ message: `'in' expects a list on the right, got ${describe(r)}` });
    }
    case 'contains':
      if (typeof l === 'string' && typeof r === 'string') return l.includes(r);
      if (Array.isArray(l)) return l.some((x) => looseEq(x, r));
      throw new ExprEvalError({ message: `'contains' expects a string or list on the left` });
    case 'startsWith':
      if (typeof l !== 'string' || typeof r !== 'string') {
        throw new ExprEvalError({ message: `'startsWith' expects two strings` });
      }
      return l.startsWith(r);
    case 'endsWith':
      if (typeof l !== 'string' || typeof r !== 'string') {
        throw new ExprEvalError({ message: `'endsWith' expects two strings` });
      }
      return l.endsWith(r);
  }
  throw new ExprEvalError({ message: `Unknown operator '${op}'` });
}

function looseEq(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a === 'number' || typeof b === 'number') {
    return toNumber(a, '==') === toNumber(b, '==');
  }
  return false;
}

function cmp(a: Value, b: Value): number {
  if (typeof a === 'number' || typeof b === 'number') {
    return toNumber(a, 'cmp') - toNumber(b, 'cmp');
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  throw new ExprEvalError({ message: `Cannot compare ${describe(a)} and ${describe(b)}` });
}
