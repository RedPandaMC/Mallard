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

export interface ParseAlertRulesResult {
  ok: true;
  doc: { version: 1 | 2; vars: Record<string, Value>; groups: AlertGroup[]; rules: AlertRule[] };
  /** Parse errors per rule, populated when expressions fail to parse. */
  errors: { ruleId: string; field: 'when' | 'active' | 'derived' | string; message: string }[];
}

export function parseAlertRules(input: unknown): ParseAlertRulesResult {
  const parsed = DocSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as unknown as true,
      doc: { version: 1, vars: {}, groups: [], rules: [] },
      errors: parsed.error.issues.map((i) => ({
        ruleId: '<document>',
        field: i.path.join('.'),
        message: i.message,
      })),
    } as unknown as ParseAlertRulesResult;
  }
  const d = parsed.data;
  const rules: AlertRule[] = (d.rules ?? []).map((r) => ({
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
  const groups: AlertGroup[] = (d.groups ?? []).map((g) => ({
    id: g.id,
    active: g.active,
    ...(g.label !== undefined ? { label: g.label } : {}),
  }));
  return {
    ok: true,
    doc: {
      version: (d.version ?? 1) as 1 | 2,
      vars: (d.vars as Record<string, Value> | undefined) ?? {},
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

function durationToMs(d: string | undefined, fallback: number): number {
  if (!d) return fallback;
  const m = /^(\d+)\s*([mhdw])$/.exec(d.trim());
  if (!m) return fallback;
  const n = Number(m[1]);
  const unit = m[2]!;
  const mult =
    unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : unit === 'd' ? 86_400_000 : 604_800_000;
  return n * mult;
}

function renderTemplate(msg: string, ctx: EvalContext): string {
  return msg.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_full, inner: string) => {
    try {
      const src = inner.trim();
      // The user types `today.credits` inside `{{...}}`; prepend `vars` only
      // when the inner expression starts with `$` (explicit var reference).
      const expr = parseExpr(src);
      const v = evaluate(expr, ctx);
      if (v === null || v === undefined) return '';
      if (typeof v === 'string') return v;
      if (typeof v === 'number') {
        if (Number.isInteger(v)) return String(v);
        return v.toFixed(2);
      }
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      return JSON.stringify(v);
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
    const v = evaluate(expr, ctx);
    return { ok: true, value: Boolean(v) };
  } catch (e) {
    return { ok: false, error: e instanceof ExprEvalError ? e.message : String(e) };
  }
}

export interface EvaluateInput extends EvalBuildInput {
  rules: AlertRule[];
  groups?: AlertGroup[];
  /** Cooldown bookkeeping; mutated (sets rule keys when fired). */
  fired: Map<string, number>;
  now?: number;
}

export function evaluateAlertRules(input: EvaluateInput): AlertFireResult[] {
  const now = input.now ?? Date.now();
  const fired: AlertFireResult[] = [];

  // Resolve group expressions once, then expose under `vars.group`.
  const baseCtx = buildEvalContext(input);
  const groupVars: Record<string, Value> = {};
  for (const g of input.groups ?? []) {
    const res = tryEvalBool(g.active, baseCtx);
    const active = res.ok ? res.value : true;
    groupVars[g.id] = active as unknown as Value;
  }
  const ctx: EvalContext = {
    ...baseCtx,
    vars: { ...baseCtx.vars, group: groupVars as unknown as Value },
  };

  for (const rule of input.rules) {
    if (rule.requiresAuth && !ctx.resolve([{ name: 'signedIn' }])) continue;

    // Per-rule derived values, then evaluate the rule.
    const ruleCtxVars: Record<string, Value> = { ...ctx.vars };
    // Derived names live alongside the top-level context tree so a bare
    // identifier in the `when` expression (e.g. `premiumShare > 0.5`)
    // resolves correctly.
    const ruleCtx: EvalContext = {
      ...ctx,
      vars: ruleCtxVars,
      resolve: (parts) => {
        const v = ctx.resolve(parts);
        if (v !== null) return v;
        // Fall back to vars (covers derived values and `$vars.x` lookups
        // expressed as a bare path).
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
          const expr = parseExpr(src);
          ruleCtxVars[name] = evaluate(expr, ruleCtx);
        } catch {
          // Surface as warning; treat as null so the rest of the rule still runs.
          ruleCtxVars[name] = null;
        }
      }
    }

    // Group check (if rule references a group)
    if (rule.restrict?.scope === 'custom' && rule.restrict) {
      // Allow custom extensions list from vars.copilotExtensions
    }

    if (rule.active) {
      const res = tryEvalBool(rule.active, ruleCtx);
      if (!res.ok || !res.value) continue;
    }

    const key = `${rule.id}#${rule.severity}`;
    const lastFired = input.fired.get(key);
    const cooldownMs = durationToMs(rule.cooldown, 60 * 60_000);
    if (lastFired !== undefined && now - lastFired < cooldownMs) continue;

    let passed = false;
    try {
      const expr = parseExpr(rule.when);
      const v = evaluate(expr, ruleCtx);
      if (!v) continue;
      passed = true;
    } catch {
      continue;
    }
    if (!passed) continue;

    input.fired.set(key, now);
    fired.push({
      key,
      ruleId: rule.id,
      severity: rule.severity,
      message: renderTemplate(rule.message, ruleCtx),
      rule,
    });
  }
  return fired;
}
