/**
 * Alert-rule evaluation: turns the user-authored rules document into the
 * AlertEvent[] the host surfaces as toast messages. Pure.
 */
import { z } from 'zod';
import { AlertRule, AlertGroup } from './types';
import { parseExpr } from './expr/parse';
import { evaluate, EvalContext } from './expr/eval';
import { buildEvalContext, EvalBuildInput } from './expr/context';
import { ExprEvalError, Value } from './expr/ast';

const RuleSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(['info', 'warning', 'critical']).default('warning'),
  cooldown: z.string().optional(),
  message: z.string(),
  when: z.string(),
  active: z.string().optional(),
  derived: z.record(z.string(), z.string()).optional(),
  requiresAuth: z.boolean().optional(),
  notify: z.boolean().optional(),
  restrict: z
    .object({
      mode: z.enum(['soft', 'hard']),
      scope: z.enum(['copilot', 'copilot+lab', 'custom']),
      reEnableWhen: z.string().optional(),
      graceMinutes: z
        .number()
        .min(0)
        .max(60 * 24)
        .optional(),
    })
    .optional(),
});

const GroupSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  active: z.string(),
});

const VarsSchema = z.record(
  z.string(),
  z.union([z.number(), z.string(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
);

const DocSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]).optional(),
    vars: VarsSchema.optional(),
    groups: z.array(GroupSchema).optional(),
    rules: z.array(RuleSchema).optional(),
    budget: z
      .object({
        monthlyUsd: z.number(),
        includedCredits: z.number(),
      })
      .optional(),
  })
  .partial();

type ParseRuleError = { ruleId: string; field: 'when' | 'active' | 'derived' | string; message: string };
type ParsedDoc = { version: 1 | 2; vars: Record<string, Value>; groups: AlertGroup[]; rules: AlertRule[] };

export type ParseAlertRulesResult =
  | { ok: true; doc: ParsedDoc; errors: ParseRuleError[] }
  | { ok: false; doc: ParsedDoc; errors: ParseRuleError[] };

export function parseAlertRules(input: unknown): ParseAlertRulesResult {
  const parsed = DocSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      doc: { version: 1, vars: {}, groups: [], rules: [] },
      errors: parsed.error.issues.map((i) => ({
        ruleId: '<document>',
        field: i.path.join('.'),
        message: i.message,
      })),
    };
  }
  const parsedDoc = parsed.data;
  const rules: AlertRule[] = (parsedDoc.rules ?? []).map((r) => ({
    id: r.id,
    severity: r.severity,
    ...(r.cooldown !== undefined ? { cooldown: r.cooldown } : {}),
    message: r.message,
    when: r.when,
    ...(r.active !== undefined ? { active: r.active } : {}),
    ...(r.derived !== undefined ? { derived: r.derived } : {}),
    ...(r.requiresAuth !== undefined ? { requiresAuth: r.requiresAuth } : {}),
    ...(r.notify !== undefined ? { notify: r.notify } : {}),
    ...(r.restrict !== undefined
      ? {
          restrict: {
            mode: r.restrict.mode,
            scope: r.restrict.scope,
            ...(r.restrict.reEnableWhen !== undefined
              ? { reEnableWhen: r.restrict.reEnableWhen }
              : {}),
            ...(r.restrict.graceMinutes !== undefined
              ? { graceMinutes: r.restrict.graceMinutes }
              : {}),
          },
        }
      : {}),
  }));
  const groups: AlertGroup[] = (parsedDoc.groups ?? []).map((g) => ({
    id: g.id,
    active: g.active,
    ...(g.label !== undefined ? { label: g.label } : {}),
  }));
  return {
    ok: true,
    doc: {
      version: (parsedDoc.version ?? 1) as 1 | 2,
      vars: (parsedDoc.vars as Record<string, Value> | undefined) ?? {},
      groups,
      rules,
    },
    errors: [],
  };
}

export interface AlertFireResult {
  /** Stable id used for cooldown bookkeeping (includes severity for per-severity cooldowns). */
  key: string;
  ruleId: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  /** The rule object (so the engine can use restrict etc. without re-deriving). */
  rule: AlertRule;
}

function durationToMs(duration: string | undefined, fallback: number): number {
  if (!duration) return fallback;
  const match = /^(\d+)\s*([mhdw])$/.exec(duration.trim());
  if (!match) return fallback;
  const numericPart = Number(match[1]);
  const unit = match[2]!;
  const mult =
    unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : unit === 'd' ? 86_400_000 : 604_800_000;
  return numericPart * mult;
}

function renderTemplate(msg: string, ctx: EvalContext): string {
  return msg.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_full, inner: string) => {
    try {
      const src = inner.trim();
      // The user types `today.credits` inside `{{...}}`; prepend `vars` only
      // when the inner expression starts with `$` (explicit var reference).
      const expr = parseExpr(src);
      const value = evaluate(expr, ctx);
      if (value === null || value === undefined) return '';
      if (typeof value === 'string') return value;
      if (typeof value === 'number') {
        if (Number.isInteger(value)) return String(value);
        return value.toFixed(2);
      }
      if (typeof value === 'boolean') return value ? 'true' : 'false';
      return JSON.stringify(value);
    } catch {
      return `?{${inner}}`;
    }
  });
}

function tryEvalBool(
  src: string | undefined,
  ctx: EvalContext,
): { ok: true; value: boolean } | { ok: false; error: string } {
  if (!src) return { ok: true, value: true };
  try {
    const expr = parseExpr(src);
    const value = evaluate(expr, ctx);
    return { ok: true, value: Boolean(value) };
  } catch (error) {
    return { ok: false, error: error instanceof ExprEvalError ? error.message : String(error) };
  }
}

export interface EvaluateInput extends EvalBuildInput {
  rules: AlertRule[];
  groups?: AlertGroup[];
  /** Cooldown bookkeeping; mutated (sets rule keys when fired). */
  fired: Map<string, number>;
  now?: number;
}

function evaluateRule(
  rule: AlertRule,
  ctx: EvalContext,
  firedMap: Map<string, number>,
  now: number,
): AlertFireResult | null {
  if (rule.requiresAuth && !ctx.resolve([{ name: 'signedIn' }])) return null;

  const ruleCtxVars: Record<string, Value> = { ...ctx.vars };
  const ruleCtx: EvalContext = {
    ...ctx,
    vars: ruleCtxVars,
    resolve: (parts) => {
      const v = ctx.resolve(parts);
      if (v !== null) return v;
      let cur: Value | undefined = ruleCtxVars[parts[0]?.name ?? ''];
      for (let i = 1; i < parts.length && cur !== undefined; i++) {
        if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return null;
        cur = (cur as Record<string, Value>)[parts[i]?.name ?? ''];
      }
      return cur ?? null;
    },
  };

  if (rule.derived) {
    for (const [name, src] of Object.entries(rule.derived)) {
      try {
        ruleCtxVars[name] = evaluate(parseExpr(src), ruleCtx);
      } catch {
        ruleCtxVars[name] = null;
      }
    }
  }

  if (rule.active) {
    const res = tryEvalBool(rule.active, ruleCtx);
    if (!res.ok || !res.value) return null;
  }

  const key = `${rule.id}#${rule.severity}`;
  const lastFired = firedMap.get(key);
  const cooldownMs = durationToMs(rule.cooldown, 60 * 60_000);
  if (lastFired !== undefined && now - lastFired < cooldownMs) return null;

  try {
    const v = evaluate(parseExpr(rule.when), ruleCtx);
    if (!v) return null;
  } catch {
    return null;
  }

  firedMap.set(key, now);
  return {
    key,
    ruleId: rule.id,
    severity: rule.severity,
    message: renderTemplate(rule.message, ruleCtx),
    rule,
  };
}

export function evaluateAlertRules(input: EvaluateInput): AlertFireResult[] {
  const now = input.now ?? Date.now();

  const baseCtx = buildEvalContext(input);
  const groupVars: Record<string, Value> = {};
  for (const g of input.groups ?? []) {
    const res = tryEvalBool(g.active, baseCtx);
    groupVars[g.id] = res.ok ? res.value : true;
  }
  const ctx: EvalContext = {
    ...baseCtx,
    vars: { ...baseCtx.vars, group: groupVars as unknown as Value },
  };

  return input.rules.flatMap((rule) => {
    const result = evaluateRule(rule, ctx, input.fired, now);
    return result ? [result] : [];
  });
}
