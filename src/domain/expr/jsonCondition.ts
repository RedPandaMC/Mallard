/**
 * Minimal JSONLogic-inspired condition evaluator.
 *
 * Conditions are plain JSON objects — no custom DSL, no parser.
 * VS Code's JSON language server validates them against the bundled schema.
 *
 * Supported operators: >, >=, <, <=, ==, !=, and, or, not, var (truthy check)
 * Also: in, matches (via compileConditions / evalSimpleCondition)
 * Operands: number | string | boolean | { "var": "dot.path" }
 */
import { z } from 'zod';
import type { JsonCondition, JsonOperand, SimpleCondition } from '../types';

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

// ── SimpleCondition evaluator ────────────────────────────────────────────────

/**
 * Evaluate a single structured condition against the rule context.
 * Supports all JSONLogic operators plus `in` and `matches`.
 */
export function evalSimpleCondition(c: SimpleCondition, ctx: Record<string, unknown>): boolean {
  const fieldValue = resolveVar(c.field, ctx);

  if (c.op === 'in') {
    const allowed = Array.isArray(c.value) ? c.value : [c.value];
    return allowed.includes(fieldValue as string | number);
  }

  if (c.op === 'matches') {
    try {
      return new RegExp(String(c.value)).test(String(fieldValue ?? ''));
    } catch {
      return false;
    }
  }

  return compare(fieldValue, c.value, c.op);
}

/**
 * Compile a structured `conditions` array + `match` mode into a `JsonCondition`
 * that can be stored or evaluated by `evalCondition()`.
 *
 * `match: "all"` → `{ "and": [...] }` (default)
 * `match: "any"` → `{ "or": [...] }`
 * `match: "none"` → `{ "not": { "or": [...] } }`
 *
 * `in` and `matches` conditions are evaluated via `evalSimpleCondition()` and
 * represented as a boolean literal after pre-evaluation, or left as-is when
 * no context is available (they have no direct JSONLogic encoding).
 */
export function compileConditions(
  conditions: SimpleCondition[],
  match: 'all' | 'any' | 'none' = 'all',
  ctx?: Record<string, unknown>,
): JsonCondition {
  if (conditions.length === 0) return true;

  // Map each SimpleCondition to a JsonCondition, handling in/matches specially.
  const parts: JsonCondition[] = conditions.map((c) => {
    if (c.op === 'in' || c.op === 'matches') {
      // No direct JSONLogic encoding — if context is available, pre-evaluate.
      return ctx !== undefined ? evalSimpleCondition(c, ctx) : true;
    }
    const val = Array.isArray(c.value) ? c.value[0] ?? 0 : c.value;
    const fieldRef: JsonOperand = { var: c.field };
    const valRef: JsonOperand = val as JsonOperand;
    return { [c.op]: [fieldRef, valRef] } as JsonCondition;
  });

  if (parts.length === 1) {
    const single = parts[0]!;
    if (match === 'none') return { not: single };
    return single;
  }

  if (match === 'any') return { or: parts };
  if (match === 'none') return { not: { or: parts } };
  return { and: parts };
}

/**
 * Evaluate a rule's condition, supporting both `when` (JSONLogic) and
 * `conditions` (SimpleCondition array) fields. Returns false when neither is set.
 */
export function evalRule(
  rule: { when?: JsonCondition; conditions?: SimpleCondition[]; match?: 'all' | 'any' | 'none' },
  ctx: Record<string, unknown>,
): boolean {
  if (rule.when !== undefined) return evalCondition(rule.when, ctx);
  if (rule.conditions?.length) {
    return evalRuleConditions(rule.conditions, rule.match ?? 'all', ctx);
  }
  return false;
}

function evalRuleConditions(
  conditions: SimpleCondition[],
  match: 'all' | 'any' | 'none',
  ctx: Record<string, unknown>,
): boolean {
  const results = conditions.map((c) => evalSimpleCondition(c, ctx));
  if (match === 'any')  return results.some(Boolean);
  if (match === 'none') return results.every((r) => !r);
  return results.every(Boolean); // 'all'
}
