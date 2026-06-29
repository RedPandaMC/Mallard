/* c8 ignore next */
/**
 * Pure alert evaluation. Given the current snapshot, a short rolling history of
 * samples, the user's config, and the map of when each alert last fired, returns
 * the alerts that should fire now (respecting per-alert cooldowns). No vscode,
 * no side effects — fully unit-testable.
 */
import { UsageSnapshot, UserConfig } from './types';

const BUDGET_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 1 day
const VELOCITY_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

/** A point-in-time sample used to estimate spending velocity. */
export interface SnapshotSample {
  ts: number;
  todayCredits: number;
}

export interface AlertEvent {
  /** Stable key for cooldown bookkeeping. */
  key: string;
  message: string;
}

function ready(fired: ReadonlyMap<string, number>, key: string, cooldown: number, now: number): boolean {
  const last = fired.get(key);
  return last === undefined || now - last > cooldown;
}

/** Credits/hour over the available history window; null if too little history. */
export function velocityCreditsPerHour(history: readonly SnapshotSample[]): number | null {
  if (history.length < 2) return null;
  const first = history[0]!;
  const last = history[history.length - 1]!;
  const hours = (last.ts - first.ts) / (60 * 60 * 1000);
  if (hours <= 0) return null;
  const delta = last.todayCredits - first.todayCredits;
  if (delta <= 0) return null;
  return delta / hours;
}

/* c8 ignore next */
export function evaluateAlerts(
  s: UsageSnapshot,
  history: readonly SnapshotSample[],
  config: UserConfig,
  fired: ReadonlyMap<string, number>,
  now: number,
): AlertEvent[] {
  const out: AlertEvent[] = [];
  const month = new Date(now).getMonth();

  if (config.monthlyBudget > 0) {
    const pct = s.budget.percentOfBudget;
    const at80 = `budget-80-${month}`;
    const at100 = `budget-100-${month}`;
    if (pct >= 1.0 && ready(fired, at100, BUDGET_COOLDOWN_MS, now)) {
      out.push({ key: at100, message: `Mallard: Monthly budget of $${config.monthlyBudget} exceeded.` });
    } else if (pct >= 0.8 && pct < 1.0 && ready(fired, at80, BUDGET_COOLDOWN_MS, now)) {
      out.push({
        key: at80,
        message: `Mallard: You've used 80% of your $${config.monthlyBudget} monthly budget.`,
      });
    }
  }

  if (config.dailyCreditAlert > 0) {
    const key = `daily-${new Date(now).toDateString()}`;
    if (s.today.credits >= config.dailyCreditAlert && ready(fired, key, DAILY_COOLDOWN_MS, now)) {
      out.push({
        key,
        message: `Mallard: Daily credit usage (${Math.round(s.today.credits)}) exceeded your threshold of ${config.dailyCreditAlert}.`,
      });
    }
  }

  if (config.alerts.velocityEnabled && config.alerts.velocityCreditsPerHour > 0) {
    const rate = velocityCreditsPerHour(history);
    const key = 'velocity';
    if (
      rate !== null &&
      rate >= config.alerts.velocityCreditsPerHour &&
      ready(fired, key, VELOCITY_COOLDOWN_MS, now)
    ) {
      out.push({
        key,
        message: `Mallard: Spending is fast — about ${Math.round(rate)} credits/hour (threshold ${config.alerts.velocityCreditsPerHour}).`,
      });
    }
  }

  if (s.currentBranch && config.branchBudgets) {
    const cap = config.branchBudgets[s.currentBranch] ?? null;
    if (cap !== null && s.currentBranchCredits >= cap) {
      const key = `branch:${s.currentBranch}`;
      if (ready(fired, key, BUDGET_COOLDOWN_MS, now)) {
        out.push({
          key,
          message: `Mallard: Branch '${s.currentBranch}' has used ${Math.round(s.currentBranchCredits)} cr of its ${cap} cr cap.`,
        });
      }
    }
  }

  return out;
}
