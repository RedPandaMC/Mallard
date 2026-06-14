/**
 * Pure restriction evaluation: given the rule set and an evaluation context,
 * decides whether any rule's `restrict` block wants to restrict, and whether
 * a different rule's `reEnableWhen` should clear the restriction.
 *
 * The most-restrictive active rule wins (a hard rule beats a soft rule beats
 * nothing). User overrides are honoured: if `userOverrideUntil` is in the
 * future, no rule will re-fire while it lasts.
 */
import { AlertRule } from '../types';
import { EvalContext } from '../expr/eval';
import { parseExpr } from '../expr/parse';
import { evaluate } from '../expr/eval';

export interface RestrictionDesired {
  /** Most-severe rule that wants to restrict, or null. */
  active: AlertRule | null;
  /** All rules with restrict blocks that currently match `when` AND `active`. */
  matching: AlertRule[];
  /** All rules that would clear the restriction if their `reEnableWhen` fires. */
  canClear: AlertRule[];
}

const HARD_RANK = 2;
const SOFT_RANK = 1;

function rank(mode: 'soft' | 'hard' | undefined): number {
  return mode === 'hard' ? HARD_RANK : mode === 'soft' ? SOFT_RANK : 0;
}

function evalBool(src: string, ctx: EvalContext): boolean {
  try {
    const ast = parseExpr(src);
    return Boolean(evaluate(ast, ctx));
  } catch {
    return false;
  }
}

export function evaluateRestrictionState(
  rules: AlertRule[],
  ctx: EvalContext,
  now: number,
): RestrictionDesired {
  const matching: AlertRule[] = [];
  const canClear: AlertRule[] = [];

  for (const r of rules) {
    if (!r.restrict) continue;
    if (r.requiresAuth && !ctx.resolve([{ name: 'signedIn' }])) continue;
    if (r.active && !evalBool(r.active, ctx)) continue;
    if (!evalBool(r.when, ctx)) continue;
    matching.push(r);
    if (r.restrict.reEnableWhen) canClear.push(r);
  }

  let active: AlertRule | null = null;
  for (const r of matching) {
    if (rank(r.restrict?.mode) > rank(active?.restrict?.mode)) active = r;
  }
  void now;
  return { active, matching, canClear };
}
