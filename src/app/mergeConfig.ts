/**
 * Pure default-merge for UserConfig. Lives in its own file so it can be
 * unit-tested without pulling in the `vscode` module.
 */
import { DEFAULT_USER_CONFIG, UserConfig } from '../domain/types';

/** Merge a partial over defaults, clamping numbers to be non-negative. */
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
    version: stored?.version ?? d.version ?? 1,
    ...(stored?.vars !== undefined
      ? { vars: stored.vars }
      : d.vars !== undefined
        ? { vars: d.vars }
        : {}),
    ...(stored?.groups !== undefined
      ? { groups: stored.groups }
      : d.groups !== undefined
        ? { groups: d.groups }
        : {}),
    ...(stored?.rules !== undefined
      ? { rules: stored.rules }
      : d.rules !== undefined
        ? { rules: d.rules }
        : {}),
    ...(stored?.budget !== undefined
      ? { budget: stored.budget }
      : d.budget !== undefined
        ? { budget: d.budget }
        : {}),
  };
}
