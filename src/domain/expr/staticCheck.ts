/**
 * Lightweight type checker. Walks the AST and assigns each node a
 * `ValueType` so Monaco's hover/diagnostics can show expected types.
 *
 * Resolution is best-effort: `path` nodes return `'unknown'` because we
 * don't have the context at static-check time. The Monaco hover layer can
 * refine this by consulting a live context for the node under the cursor.
 */
import { Expr, ValueType } from './ast';
import { getFunction } from './functions';

const NUMBER_OPS = new Set(['+', '-', '*', '/', '%']);
const COMPARISON_OPS = new Set(['==', '!=', '>', '>=', '<', '<=']);
const STRING_OPS = new Set(['contains', 'startsWith', 'endsWith']);
const LOGICAL_OPS = new Set(['and', 'or']);

export function inferType(expr: Expr, lookup?: (name: string) => ValueType): ValueType {
  switch (expr.kind) {
    case 'number':
      return 'number';
    case 'string':
      return 'string';
    case 'bool':
      return 'bool';
    case 'null':
      return 'null' as ValueType;
    case 'path':
      return 'unknown';
    case 'index':
      return 'unknown';
    case 'list':
    case 'range':
      return 'list';
    case 'var':
      return lookup ? lookup(expr.name) : 'unknown';
    case 'unary':
      if (expr.op === 'not') return 'bool';
      return inferType(expr.arg, lookup);
    case 'binary': {
      if (LOGICAL_OPS.has(expr.op)) return 'bool';
      if (COMPARISON_OPS.has(expr.op)) return 'bool';
      if (expr.op === 'in') return 'bool';
      if (STRING_OPS.has(expr.op)) return 'bool';
      if (expr.op === '??') return inferType(expr.left, lookup);
      if (NUMBER_OPS.has(expr.op)) return 'number';
      if (expr.op === '+') {
        const l = inferType(expr.left, lookup);
        const r = inferType(expr.right, lookup);
        if (l === 'string' || r === 'string') return 'string';
        return 'number';
      }
      return 'unknown';
    }
    case 'call': {
      const spec = getFunction(expr.name);
      return spec ? spec.returnType : 'unknown';
    }
  }
}
