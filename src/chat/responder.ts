/**
 * Pure snapshot → markdown rendering for @weevil answers. All numbers come from
 * the snapshot; nothing is invented here.
 */
import { formatCredits, formatMoney, formatTokens } from '../model/format';
import { UsageAggregate, UsageSnapshot } from '../model/types';
import { startOf } from '../util/time';
import { ChatIntent } from './intent';

function dayAgg(s: UsageSnapshot): UsageAggregate | undefined {
  const key = startOf(s.generatedAt, 'day');
  return s.aggregates.day.find((a) => a.start === key);
}

function topModel(a: UsageAggregate): string | undefined {
  let best: string | undefined;
  let bestCredits = -1;
  for (const [k, v] of Object.entries(a.byModel)) {
    if (v.credits > bestCredits) {
      bestCredits = v.credits;
      best = k;
    }
  }
  return best;
}

export function respond(intent: ChatIntent, s: UsageSnapshot): string {
  switch (intent.kind) {
    case 'today': {
      const d = dayAgg(s);
      if (!d || d.eventCount === 0) return `No Copilot usage recorded **today** yet.`;
      const tm = topModel(d);
      return (
        `Today you've spent **${formatMoney(d.cost, s.currency)}** across **${d.eventCount}** ` +
        `requests (**${formatCredits(d.credits)}** credits · ${formatTokens(d.tokens)} tokens).` +
        (tm ? ` Top model: **${tm}**.` : '')
      );
    }

    case 'forecast': {
      const f = s.forecast;
      if (f.basis === 'insufficient-data') {
        return (
          `Not enough usage yet this month to forecast confidently. ` +
          `Month-to-date: **${formatMoney(s.budget.usedCost, s.currency)}**.`
        );
      }
      const budgetLine = s.budget.monthly
        ? ` against your **${formatMoney(s.budget.monthly, s.currency)}** budget (${s.budget.pace})`
        : '';
      const lo = formatMoney(f.low * s.pricePerCredit, s.currency);
      const hi = formatMoney(f.high * s.pricePerCredit, s.currency);
      return (
        `At your current pace you'll reach **${formatMoney(f.projectedCost, s.currency)}** ` +
        `by month-end${budgetLine} — likely between ${lo} and ${hi}.`
      );
    }

    case 'models': {
      if (!s.topModels.length) return `No usage to break down by model yet.`;
      const lines = s.topModels
        .map(
          (m) => `- **${m.key}** — ${formatMoney(m.cost, s.currency)} · ${formatCredits(m.credits)} cr`,
        )
        .join('\n');
      return `Spend by model:\n${lines}`;
    }

    case 'repos': {
      if (!s.topRepos.length) return `No usage to break down by repository yet.`;
      const lines = s.topRepos
        .map(
          (r) => `- **${r.key}** — ${formatMoney(r.cost, s.currency)} · ${formatCredits(r.credits)} cr`,
        )
        .join('\n');
      return `Spend by repository:\n${lines}`;
    }

    default: {
      const d = dayAgg(s);
      const today = d ? formatMoney(d.cost, s.currency) : '—';
      return (
        `**This month:** ${formatMoney(s.budget.usedCost, s.currency)} · ` +
        `${formatCredits(s.budget.usedCredits)} cr. **Today:** ${today}. ` +
        `**Projected month-end:** ${formatMoney(s.forecast.projectedCost, s.currency)}.`
      );
    }
  }
}
