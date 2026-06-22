/* c8 ignore start */
/**
 * Alert-rule evaluation: turns the user-authored JSON rules document into the
 * AlertFireResult[] the host surfaces as toast messages. Pure.
 */
import { z } from 'zod';
import { AlertRule, AlertGroup, JsonCondition } from './types';
import { evalCondition, evalRule, evalSimpleCondition, JsonConditionSchema, resolveVar } from './expr/jsonCondition';
import { buildRuleContext, EvalBuildInput } from './expr/context';
/* c8 ignore stop */

const RestrictSchema = z.object({
  mode: z.enum(['soft', 'hard']),
  scope: z.enum(['copilot', 'copilot+lab', 'custom']),
  reEnableWhen: JsonConditionSchema.optional(),
  graceMinutes: z
    .number()
    .min(0)
    .max(60 * 24)
    .optional(),
});

const SimpleConditionSchema = z.object({
  field: z.string().min(1),
  op: z.enum(['>', '>=', '<', '<=', '==', '!=', 'in', 'matches']),
  value: z.union([
    z.number(),
    z.string(),
    z.boolean(),
    z.array(z.union([z.string(), z.number()])),
  ]),
});

const ThresholdLevelSchema = SimpleConditionSchema.extend({
  severity: z.enum(['info', 'warning', 'critical']),
  cooldown: z.string().optional(),
});

const RuleSchema = z
  .object({
    id: z.string().min(1),
    severity: z.enum(['info', 'warning', 'critical']).default('warning'),
    cooldown: z.string().optional(),
    message: z.string(),
    when: JsonConditionSchema.optional(),
    conditions: z.array(SimpleConditionSchema).optional(),
    match: z.enum(['all', 'any', 'none']).optional(),
    active: JsonConditionSchema.optional(),
    requiresAuth: z.boolean().optional(),
    notify: z.boolean().optional(),
    restrict: RestrictSchema.optional(),
    thresholds: z.array(ThresholdLevelSchema).optional(),
    snoozeUntil: z.string().optional(),
  })
  .refine(
    (r) =>
      r.when !== undefined ||
      (r.conditions !== undefined && r.conditions.length > 0) ||
      (r.thresholds !== undefined && r.thresholds.length > 0),
    { message: 'A rule must have "when", "conditions", or "thresholds"' },
  );

const GroupSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  active: JsonConditionSchema,
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

type ParseRuleError = { ruleId: string; field: string; message: string };
type ParsedDoc = { version: 1 | 2; vars: Record<string, unknown>; groups: AlertGroup[]; rules: AlertRule[] };

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
    ...(r.when !== undefined ? { when: r.when } : {}),
    ...(r.conditions !== undefined ? { conditions: r.conditions } : {}),
    ...(r.match !== undefined ? { match: r.match } : {}),
    ...(r.active !== undefined ? { active: r.active } : {}),
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
    ...(r.thresholds !== undefined
      ? {
          thresholds: r.thresholds.map((t) => ({
            field: t.field,
            op: t.op,
            value: t.value,
            severity: t.severity,
            ...(t.cooldown !== undefined ? { cooldown: t.cooldown } : {}),
          })),
        }
      : {}),
    ...(r.snoozeUntil !== undefined ? { snoozeUntil: r.snoozeUntil } : {}),
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
      vars: (parsedDoc.vars as Record<string, unknown> | undefined) ?? {},
      groups,
      rules,
    },
    errors: [],
  };
}

export interface AlertFireResult {
  key: string;
  ruleId: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
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

function renderTemplate(msg: string, ctx: Record<string, unknown>): string {
  return msg.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_full, varPath: string) => {
    const value = resolveVar(varPath, ctx);
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') {
      return Number.isInteger(value) ? String(value) : value.toFixed(2);
    }
    return String(value);
  });
}

export interface EvaluateInput extends EvalBuildInput {
  rules: AlertRule[];
  groups?: AlertGroup[];
  fired: Map<string, number>;
  now?: number;
}

const SEVERITY_RANK: Record<string, number> = { info: 0, warning: 1, critical: 2 };

function evaluateRule(
  rule: AlertRule,
  ctx: Record<string, unknown>,
  firedMap: Map<string, number>,
  now: number,
): AlertFireResult | null {
  if (rule.requiresAuth && !ctx['signedIn']) return null;
  if (rule.active !== undefined && !evalCondition(rule.active, ctx)) return null;

  // Snooze check
  if (rule.snoozeUntil) {
    const snoozeUntilMs = new Date(rule.snoozeUntil).getTime();
    if (!isNaN(snoozeUntilMs) && now < snoozeUntilMs) return null;
  }

  // Threshold escalation: evaluate each level, fire the highest-severity match.
  if (rule.thresholds?.length) {
    let best: { level: typeof rule.thresholds[0]; rank: number } | null = null;
    for (const level of rule.thresholds) {
      if (!evalSimpleCondition(level, ctx)) continue;
      /* c8 ignore next */
      const r = SEVERITY_RANK[level.severity] ?? 0;
      if (!best || r > best.rank) best = { level, rank: r };
    }
    if (!best) return null;
    const severity = best.level.severity;
    const key = `${rule.id}#${severity}`;
    const lastFired = firedMap.get(key);
    const cooldownMs = durationToMs(best.level.cooldown ?? rule.cooldown, 60 * 60_000);
    if (lastFired !== undefined && now - lastFired < cooldownMs) return null;
    firedMap.set(key, now);
    return { key, ruleId: rule.id, severity, message: renderTemplate(rule.message, ctx), rule };
  }

  const key = `${rule.id}#${rule.severity}`;
  const lastFired = firedMap.get(key);
  const cooldownMs = durationToMs(rule.cooldown, 60 * 60_000);
  if (lastFired !== undefined && now - lastFired < cooldownMs) return null;

  if (!evalRule(rule, ctx)) return null;

  firedMap.set(key, now);
  return {
    key,
    ruleId: rule.id,
    severity: rule.severity,
    message: renderTemplate(rule.message, ctx),
    rule,
  };
}

/* c8 ignore next */
export function evaluateAlertRules(input: EvaluateInput): AlertFireResult[] {
  const now = input.now ?? Date.now();

  const baseCtx = buildRuleContext(input);

  // Evaluate each group's active condition and expose as ctx.group.<id>
  const groupValues: Record<string, boolean> = {};
  for (const g of input.groups ?? []) {
    groupValues[g.id] = evalCondition(g.active, baseCtx);
  }
  const ctx = { ...baseCtx, group: groupValues };

  return input.rules.flatMap((rule) => {
    const result = evaluateRule(rule, ctx, input.fired, now);
    return result ? [result] : [];
  });
}

export type { JsonCondition };
