/**
 * Minimal JSONLogic-inspired condition evaluator.
 *
 * Conditions are plain JSON objects — no custom DSL, no parser.
 * VS Code's JSON language server validates them against the bundled schema.
 *
 * Supported operators: >, >=, <, <=, ==, !=, and, or, not, var (truthy check)
 * Operands: number | string | boolean | { "var": "dot.path" }
 */
import { z } from 'zod';
import type { JsonCondition, JsonOperand } from '../types';

// ── Zod schemas (used in alertRules.ts and UserConfigStore.ts) ───────────────

export const JsonOperandSchema: z.ZodType<JsonOperand> = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.object({ var: z.string() }),
]);

export const JsonConditionSchema: z.ZodType<JsonCondition> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.object({ '>':  z.tuple([JsonOperandSchema, JsonOperandSchema]) }),
    z.object({ '>=': z.tuple([JsonOperandSchema, JsonOperandSchema]) }),
    z.object({ '<':  z.tuple([JsonOperandSchema, JsonOperandSchema]) }),
    z.object({ '<=': z.tuple([JsonOperandSchema, JsonOperandSchema]) }),
    z.object({ '==': z.tuple([JsonOperandSchema, JsonOperandSchema]) }),
    z.object({ '!=': z.tuple([JsonOperandSchema, JsonOperandSchema]) }),
    z.object({ 'and': z.array(JsonConditionSchema) }),
    z.object({ 'or':  z.array(JsonConditionSchema) }),
    z.object({ 'not': JsonConditionSchema }),
    z.object({ 'var': z.string() }),
  ]),
);

// ── Evaluator ────────────────────────────────────────────────────────────────

/** Walk a dot-separated path into a plain context object. */
export function resolveVar(varPath: string, ctx: Record<string, unknown>): unknown {
  const parts = varPath.split('.');
  let current: unknown = ctx;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveOperand(op: JsonOperand, ctx: Record<string, unknown>): unknown {
  if (op !== null && typeof op === 'object' && 'var' in op) return resolveVar(op.var, ctx);
  return op;
}

function compare(left: unknown, right: unknown, op: string): boolean {
  if (op === '==' ) return left === right;
  if (op === '!=' ) return left !== right;
  const l = Number(left);
  const r = Number(right);
  if (isNaN(l) || isNaN(r)) return false;
  if (op === '>' ) return l > r;
  if (op === '>=') return l >= r;
  if (op === '<' ) return l < r;
  if (op === '<=') return l <= r;
  return false;
}

export function evalCondition(cond: JsonCondition, ctx: Record<string, unknown>): boolean {
  if (typeof cond === 'boolean') return cond;
  if ('var' in cond) return Boolean(resolveVar(cond.var, ctx));
  if ('not' in cond) return !evalCondition(cond.not, ctx);
  if ('and' in cond) return cond.and.every((c) => evalCondition(c, ctx));
  if ('or'  in cond) return cond.or.some((c) => evalCondition(c, ctx));

  const ops = ['>', '>=', '<', '<=', '==', '!='] as const;
  for (const op of ops) {
    if (op in cond) {
      const [lhs, rhs] = (cond as Record<string, [JsonOperand, JsonOperand]>)[op]!;
      return compare(resolveOperand(lhs!, ctx), resolveOperand(rhs!, ctx), op);
    }
  }
  return false;
}
