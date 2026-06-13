/**
 * Pure budget / pace math. Drives KPI cards, the status-bar tint, and
 * notification evaluation. (No pet — the weevil is branding only.)
 */
import { BudgetState, Forecast, PaceStatus } from './types';

export interface BudgetInput {
  monthlyBudget: number | null;
  includedCredits: number;
  mtdCredits: number;
  mtdCost: number;
  forecast: Forecast;
}

export function computeBudget(input: BudgetInput): BudgetState {
  const { monthlyBudget, includedCredits, mtdCredits, mtdCost, forecast } = input;

  const percentOfIncluded = includedCredits > 0 ? mtdCredits / includedCredits : 0;

  let percentOfBudget = 0;
  let projectedOverage: number | null = null;
  let pace: PaceStatus = 'no-budget';

  if (monthlyBudget && monthlyBudget > 0) {
    percentOfBudget = mtdCost / monthlyBudget;
    const projectedCost = forecast.projectedCost;
    const overage = projectedCost - monthlyBudget;
    projectedOverage = overage > 0 ? overage : null;

    const projectedRatio = projectedCost / monthlyBudget;
    if (projectedRatio <= 0.8) pace = 'under';
    else if (projectedRatio <= 1.0) pace = 'on-track';
    else if (projectedRatio <= 1.25) pace = 'warning';
    else pace = 'over';
  }

  return {
    monthly: monthlyBudget ?? null,
    includedCredits,
    usedCredits: mtdCredits,
    usedCost: mtdCost,
    percentOfBudget,
    percentOfIncluded,
    projectedOverage,
    pace,
  };
}

/** Severity for status-bar tinting — independent of whether a budget is set. */
export function severityFor(state: BudgetState): 'normal' | 'warning' | 'error' {
  if (state.pace === 'over') return 'error';
  if (state.pace === 'warning') return 'warning';
  if (state.includedCredits > 0 && state.percentOfIncluded >= 1) return 'warning';
  return 'normal';
}
