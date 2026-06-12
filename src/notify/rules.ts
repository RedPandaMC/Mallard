/**
 * Pure notification-rule evaluation. The host's NotificationEngine adds
 * debouncing and toasts on top of these results.
 */
import { sumEvents } from '../model/aggregate';
import { formatMetric } from '../model/format';
import { Filter, Metric, UsageEvent } from '../model/types';
import { startOf } from '../util/time';

export type RuleType = 'threshold' | 'velocity';
export type RuleScope = 'hour' | 'day' | 'week' | 'month';
export type RuleChannel = 'toast' | 'status-only';

export interface NotificationRule {
  id: string;
  type: RuleType;
  metric: Metric;
  scope?: RuleScope;
  /** velocity window, e.g. "1h", "30m". */
  window?: string;
  value: number;
  filter?: Filter;
  channel?: RuleChannel;
}

export interface Alert {
  ruleId: string;
  metric: Metric;
  actual: number;
  threshold: number;
  message: string;
  channel: RuleChannel;
}

export function parseWindowMs(w: string | undefined): number {
  if (!w) return 3_600_000;
  const m = /^(\d+)\s*([smhd])$/.exec(w.trim());
  if (!m) return 3_600_000;
  const n = Number(m[1]);
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]] ?? 3_600_000;
  return n * mult;
}

function metricValue(
  sum: { credits: number; cost: number; tokens: number },
  metric: Metric,
): number {
  return metric === 'cost' ? sum.cost : metric === 'credits' ? sum.credits : sum.tokens;
}

function describeWindow(r: NotificationRule): string {
  if (r.type === 'threshold') return `this ${r.scope ?? 'day'}`;
  return `in the last ${r.window ?? '1h'}`;
}

export function evaluateRules(
  events: UsageEvent[],
  rules: NotificationRule[],
  now: number,
  currency: string,
): Alert[] {
  const alerts: Alert[] = [];
  for (const r of rules) {
    if (!r || typeof r.value !== 'number') continue;
    let rangeStart: number;
    const rangeEnd = now + 1;
    if (r.type === 'velocity') {
      rangeStart = now - parseWindowMs(r.window);
    } else {
      const scope = r.scope ?? 'day';
      rangeStart = startOf(now, scope);
    }
    const f: Filter = { ...(r.filter ?? {}), range: { start: rangeStart, end: rangeEnd } };
    const sum = sumEvents(events, f);
    const actual = metricValue(sum, r.metric);
    if (actual >= r.value) {
      const formatted = formatMetric(actual, r.metric, currency);
      const limit = formatMetric(r.value, r.metric, currency);
      alerts.push({
        ruleId: r.id,
        metric: r.metric,
        actual,
        threshold: r.value,
        channel: r.channel ?? 'toast',
        message: `Weevil: ${formatted} ${describeWindow(r)} (limit ${limit}).`,
      });
    }
  }
  return alerts;
}
