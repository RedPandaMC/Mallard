/* c8 ignore next */
/**
 * Builds the rule evaluation context — a plain nested object that
 * evalCondition() and renderTemplate() walk via dot-path resolution.
 */
import { UsageSnapshot } from '../types';

export interface HistorySample {
  ts: number;
  todayCredits: number;
}

export interface EvalBuildInput {
  snapshot: UsageSnapshot | null;
  /** History of past snapshots for velocity. May be empty. */
  history?: HistorySample[];
  /** User-defined variables from the rule document `vars` block. */
  vars?: Record<string, unknown>;
  /** Sign-in state — needed by `requiresAuth` rules. */
  signedIn?: boolean;
  /** Cooldown bookkeeping (ruleId → last fired timestamp). */
  fired?: Map<string, number>;
  /** Evaluation wall-clock time; defaults to Date.now(). */
  now?: number;
  /** Alert groups from the document; passed through to the rule evaluator. */
  groups?: import('../types').AlertGroup[];
  /** Per-branch credit budgets from UserConfig. */
  branchBudgets?: Record<string, number>;
}

const ZERO_BUDGET = {
  monthly: null,
  includedCredits: 0,
  usedCredits: 0,
  usedCost: 0,
  percentOfBudget: 0,
  percentOfIncluded: 0,
  projectedOverage: null,
  pace: 'no-budget',
} as const;

const ZERO_FORECAST = {
  granularity: 'month',
  projectedCredits: 0,
  projectedCost: 0,
  low: 0,
  high: 0,
  basis: 'insufficient-data',
  asOf: 0,
} as const;

function toFiniteNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  /* c8 ignore next */
  return fallback;
}

/* c8 ignore next */
export function buildRuleContext(input: EvalBuildInput): Record<string, unknown> {
  const now = input.now ?? Date.now();
  const snapshot = input.snapshot;

  const today = snapshot?.today ?? { credits: 0, cost: 0, tokens: 0 };
  const window7d = { credits: today.credits, cost: today.cost, tokens: today.tokens };

  const month = snapshot
    ? { credits: snapshot.budget.usedCredits, cost: snapshot.budget.usedCost, tokens: 0 }
    : { credits: 0, cost: 0, tokens: 0 };

  const budget = snapshot?.budget ?? ZERO_BUDGET;
  const forecast = snapshot?.forecast ?? ZERO_FORECAST;

  let velocityCreditsPerHour = 0;
  let velocityWindowMinutes = 0;
  if (input.history && input.history.length >= 2) {
    const first = input.history[0]!;
    const last = input.history[input.history.length - 1]!;
    const ms = last.ts - first.ts;
    if (ms > 0) {
      const delta = last.todayCredits - first.todayCredits;
      if (delta > 0) {
        velocityCreditsPerHour = (delta / ms) * 60 * 60 * 1000;
        velocityWindowMinutes = ms / 60_000;
      }
    }
  }

  const topModel = snapshot?.topModels?.[0] ?? null;
  const topSurface = snapshot?.allSurfaces?.[0] ? { id: snapshot.allSurfaces[0]!, credits: 0, cost: 0 } : null;
  const topRepo = snapshot?.byRepo?.[0] ?? null;

  const model: Record<string, { credits: number; cost: number; tokens: number }> = {};
  for (const modelEntry of snapshot?.topModels ?? [])
    model[modelEntry.key] = { credits: modelEntry.credits, cost: modelEntry.cost, tokens: 0 };
  for (const modelKey of snapshot?.allModels ?? []) {
    if (!model[modelKey]) model[modelKey] = { credits: 0, cost: 0, tokens: 0 };
  }

  const surface: Record<string, { credits: number; cost: number; tokens: number }> = {};
  for (const surfaceKey of snapshot?.allSurfaces ?? []) surface[surfaceKey] = { credits: 0, cost: 0, tokens: 0 };

  const repo: Record<string, { credits: number; cost: number; tokens: number }> = {};
  for (const repoEntry of snapshot?.byRepo ?? []) repo[repoEntry.key] = { credits: repoEntry.credits, cost: repoEntry.cost, tokens: 0 };
  for (const repoKey of snapshot?.allRepos ?? []) {
    if (!repo[repoKey]) repo[repoKey] = { credits: 0, cost: 0, tokens: 0 };
  }

  const billing = snapshot?.githubBilling
    ? {
        netAmount: snapshot.githubBilling.totalNetAmount,
        grossAmount: snapshot.githubBilling.items.reduce((acc, item) => acc + item.grossAmount, 0),
        quotaPercentRemaining: snapshot.githubBilling.quota
          ? toFiniteNumber(snapshot.githubBilling.quota.entitlement) > 0
            ? 1 -
              toFiniteNumber(snapshot.githubBilling.quota.used) /
                toFiniteNumber(snapshot.githubBilling.quota.entitlement)
            : 1
          : 1,
        unlimited: snapshot.githubBilling.quota?.unlimited ?? false,
      }
    : null;

  return {
    today,
    month,
    window7d,
    budget: {
      monthly: budget.monthly,
      includedCredits: budget.includedCredits,
      usedCredits: budget.usedCredits,
      usedCost: budget.usedCost,
      percentOfBudget: budget.percentOfBudget,
      percentOfIncluded: budget.percentOfIncluded,
      projectedOverage: budget.projectedOverage,
      pace: budget.pace,
    },
    forecast: {
      projectedCredits: forecast.projectedCredits,
      projectedCost: forecast.projectedCost,
      low: forecast.low,
      high: forecast.high,
      basis: forecast.basis,
    },
    velocity: {
      creditsPerHour: velocityCreditsPerHour,
      costPerHour: 0,
      windowMinutes: velocityWindowMinutes,
    },
    topModel: topModel
      ? { id: topModel.key, credits: topModel.credits, cost: topModel.cost }
      : null,
    /* c8 ignore next 4 */
    topSurface:
      topSurface && topSurface.id
        ? { id: topSurface.id, credits: topSurface.credits, cost: topSurface.cost }
        : null,
    topRepo: topRepo ? { id: topRepo.key, credits: topRepo.credits, cost: topRepo.cost } : null,
    model,
    surface,
    repo,
    billing,
    now: {
      weekday: new Date(now).getDay(),
      hour: new Date(now).getHours(),
      minute: new Date(now).getMinutes(),
      iso: new Date(now).toISOString(),
      ts: now,
    },
    signedIn: input.signedIn ?? !!snapshot?.githubBilling,
    currentBranch: snapshot?.currentBranch ?? null,
    currentBranchCredits: snapshot?.currentBranchCredits ?? 0,
    branchBudgets: input.branchBudgets ?? {},
    vars: input.vars ?? {},
  };
}
