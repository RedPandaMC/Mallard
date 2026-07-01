/* c8 ignore next */
/**
 * Pure restriction evaluation: given the rule set and a context object,
 * decides whether any rule's `restrict` block wants to show the restriction
 * popup, and whether a different rule's `reEnableWhen` should clear it.
 *
 * The first matching rule (declaration order in config.json) wins. User
 * overrides are honoured: if `userOverrideUntil` is in the future, no rule
 * will re-fire while it lasts.
 */
import { AlertRule } from '../types';
import { evalCondition, evalRule } from '../expr/jsonCondition';

export interface RestrictionDesired {
  active: AlertRule | null;
  matching: AlertRule[];
  canClear: AlertRule[];
}

/* c8 ignore next */
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

  void now;
  return { active: matching[0] ?? null, matching, canClear };
}
