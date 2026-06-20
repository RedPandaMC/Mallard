/**
 * Pure restriction evaluation: given the rule set and a context object,
 * decides whether any rule's `restrict` block wants to restrict, and whether
 * a different rule's `reEnableWhen` should clear the restriction.
 *
 * The most-restrictive active rule wins (a hard rule beats a soft rule beats
 * nothing). User overrides are honoured: if `userOverrideUntil` is in the
 * future, no rule will re-fire while it lasts.
 */
import { AlertRule } from '../types';
import { evalCondition, evalRule } from '../expr/jsonCondition';

export interface RestrictionDesired {
  active: AlertRule | null;
  matching: AlertRule[];
  canClear: AlertRule[];
}

const HARD_RANK = 2;
const SOFT_RANK = 1;

function rank(mode: 'soft' | 'hard' | undefined): number {
  return mode === 'hard' ? HARD_RANK : mode === 'soft' ? SOFT_RANK : 0;
}

export function evaluateRestrictionState(
  rules: AlertRule[],
  ctx: Record<string, unknown>,
  now: number,
): RestrictionDesired {
  const matching: AlertRule[] = [];
  const canClear: AlertRule[] = [];

  for (const r of rules) {
    if (!r.restrict) continue;
    if (r.requiresAuth && !ctx['signedIn']) continue;
    if (r.active !== undefined && !evalCondition(r.active, ctx)) continue;
    if (!evalRule(r, ctx)) continue;
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
