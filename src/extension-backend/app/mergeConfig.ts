/* c8 ignore next */
/**
 * Pure default-merge for UserConfig. Lives in its own file so it can be
 * unit-tested without pulling in the `vscode` module.
 */
import { DEFAULT_USER_CONFIG, UserConfig } from '../domain/types';

/** Merge a partial over defaults, clamping numbers to be non-negative. */
/* c8 ignore next */
export function mergeConfig(stored?: Partial<UserConfig>): UserConfig {
  const d = DEFAULT_USER_CONFIG;
  const nonNeg = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
  return {
    monthlyBudget: nonNeg(stored?.monthlyBudget, d.monthlyBudget),
    includedCredits: nonNeg(stored?.includedCredits, d.includedCredits),
    dailyCreditAlert: nonNeg(stored?.dailyCreditAlert, d.dailyCreditAlert),
    alerts: {
      velocityEnabled:
        typeof stored?.alerts?.velocityEnabled === 'boolean'
          ? stored.alerts.velocityEnabled
          : d.alerts.velocityEnabled,
      velocityCreditsPerHour: nonNeg(
        stored?.alerts?.velocityCreditsPerHour,
        d.alerts.velocityCreditsPerHour,
      ),
    },
    /* c8 ignore next */
    version: stored?.version ?? d.version ?? 1,
    ...(stored?.vars !== undefined
      ? { vars: stored.vars }
      : d.vars !== undefined
        /* c8 ignore next */
        ? { vars: d.vars }
        /* c8 ignore next */
        : {}),
    ...(stored?.groups !== undefined
      ? { groups: stored.groups }
      : d.groups !== undefined
        /* c8 ignore next */
        ? { groups: d.groups }
        /* c8 ignore next */
        : {}),
    ...(stored?.rules !== undefined
      ? { rules: stored.rules }
      : d.rules !== undefined
        /* c8 ignore next */
        ? { rules: d.rules }
        /* c8 ignore next */
        : {}),
    ...(stored?.budget !== undefined
      ? { budget: stored.budget }
      : d.budget !== undefined
        /* c8 ignore next */
        ? { budget: d.budget }
        /* c8 ignore next */
        : {}),
    ...(stored?.branchBudgets !== undefined
      ? { branchBudgets: stored.branchBudgets }
      : {}),
    // Pass-through blocks with no defaults. These were previously dropped
    // here (and by the zod schema), silently killing the config.json
    // githubBilling/dashboard/display features.
    ...(stored?.githubBilling !== undefined ? { githubBilling: stored.githubBilling } : {}),
    ...(stored?.dashboard !== undefined ? { dashboard: stored.dashboard } : {}),
    ...(stored?.display !== undefined ? { display: stored.display } : {}),
    ...(stored?.currency !== undefined ? { currency: stored.currency } : {}),
    ...(stored?.export !== undefined ? { export: stored.export } : {}),
  };
}
