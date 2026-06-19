/**
 * Builds the evaluation context for an alert rule. The context is a plain
 * object tree; `evaluate()` walks it via the `resolve` callback.
 */
import { UsageSnapshot } from '../types';
import { EvalContext } from './eval';
import { Value } from './ast';

export interface HistorySample {
  ts: number;
  todayCredits: number;
}

export interface EvalBuildInput {
  snapshot: UsageSnapshot | null;
  /** History of past snapshots for velocity. May be empty. */
  history?: HistorySample[];
  /** User-defined variables from the rule document `vars` block. */
  vars?: Record<string, Value>;
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
  return fallback;
}

function safePath(obj: unknown, parts: { name?: string; index?: Value }[]): Value {
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return null;
    if (p.name !== undefined) {
      if (typeof cur !== 'object') return null;
      cur = (cur as Record<string, unknown>)[p.name];
    } else if (p.index !== undefined) {
      const k = String(p.index);
      if (Array.isArray(cur)) {
        const i = Number(p.index);
        if (!Number.isInteger(i)) return null;
        const idx = i < 0 ? cur.length + i : i;
        cur = cur[idx];
      } else if (cur && typeof cur === 'object') {
        cur = (cur as Record<string, unknown>)[k];
      } else {
        return null;
      }
    } else {
      return null;
    }
  }
  return cur === undefined ? null : (cur as Value);
}

export function buildEvalContext(input: EvalBuildInput): EvalContext {
  const now = input.now ?? Date.now();
  const s = input.snapshot;

  // Derive a 7-day window from today — the snapshot doesn't carry it
  // pre-computed but the host can pre-fill window7d via the vars/snapshot
  // channel. For the simulator we leave it zero.
  const today = s?.today ?? { credits: 0, cost: 0, tokens: 0 };
  const window7d = { credits: today.credits, cost: today.cost, tokens: today.tokens };

  const month = s
    ? { credits: s.budget.usedCredits, cost: s.budget.usedCost, tokens: 0 }
    : { credits: 0, cost: 0, tokens: 0 };

  const budget = s?.budget ?? ZERO_BUDGET;
  const forecast = s?.forecast ?? ZERO_FORECAST;

  // Velocity from history (credits/hour over the available window)
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

  const topModel = s?.topModels?.[0] ?? null;
  const topSurface = s?.allSurfaces?.[0] ? { id: s.allSurfaces[0]!, credits: 0, cost: 0 } : null;
  const topRepo = s?.byRepo?.[0] ?? null;

  const model: Record<string, { credits: number; cost: number; tokens: number }> = {};
  for (const m of s?.topModels ?? [])
    model[m.key] = { credits: m.credits, cost: m.cost, tokens: 0 };
  for (const k of s?.allModels ?? []) {
    if (!model[k]) model[k] = { credits: 0, cost: 0, tokens: 0 };
  }

  const surface: Record<string, { credits: number; cost: number; tokens: number }> = {};
  for (const k of s?.allSurfaces ?? []) surface[k] = { credits: 0, cost: 0, tokens: 0 };

  const repo: Record<string, { credits: number; cost: number; tokens: number }> = {};
  for (const r of s?.byRepo ?? []) repo[r.key] = { credits: r.credits, cost: r.cost, tokens: 0 };
  for (const k of s?.allRepos ?? []) {
    if (!repo[k]) repo[k] = { credits: 0, cost: 0, tokens: 0 };
  }

  const billing = s?.githubBilling
    ? {
        netAmount: s.githubBilling.totalNetAmount,
        grossAmount: s.githubBilling.items.reduce((a, i) => a + i.grossAmount, 0),
        quotaPercentRemaining: s.githubBilling.quota
          ? toFiniteNumber(s.githubBilling.quota.entitlement) > 0
            ? 1 -
              toFiniteNumber(s.githubBilling.quota.used) /
                toFiniteNumber(s.githubBilling.quota.entitlement)
            : 1
          : 1,
        unlimited: s.githubBilling.quota?.unlimited ?? false,
      }
    : null;

  const nowInfo = {
    weekday: new Date(now).getDay(),
    hour: new Date(now).getHours(),
    minute: new Date(now).getMinutes(),
    iso: new Date(now).toISOString(),
    ts: now,
  };

  const tree: Record<string, unknown> = {
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
    topSurface:
      topSurface && topSurface.id
        ? { id: topSurface.id, credits: topSurface.credits, cost: topSurface.cost }
        : null,
    topRepo: topRepo ? { id: topRepo.key, credits: topRepo.credits, cost: topRepo.cost } : null,
    model,
    surface,
    repo,
    billing,
    now: nowInfo,
    signedIn: input.signedIn ?? !!s?.githubBilling,
    currentBranch: s?.currentBranch ?? null,
    currentBranchCredits: s?.currentBranchCredits ?? 0,
    branchBudgets: input.branchBudgets ?? {},
  };

  const vars: Record<string, Value> = { ...(input.vars ?? {}) };

  return {
    vars,
    resolve: (parts) => safePath(tree, parts),
    lookupVar: (name) => (name in vars ? vars[name]! : null),
    data: { now },
  };
}

export const _internal = { safePath };
