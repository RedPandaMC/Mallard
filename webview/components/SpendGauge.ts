import { BudgetState } from '../../src/model/types';
import { formatCredits, formatMoney } from '../../src/model/format';

export interface SpendGaugeHandle {
  update(budget: BudgetState, currency: string): void;
}

export function mountSpendGauge(el: HTMLElement): SpendGaugeHandle {
  el.innerHTML = `
    <div class="wv-gauge-section">
      <div class="wv-gauge-header">
        <span class="wv-gauge-label">Credits this month</span>
        <span class="wv-gauge-values" id="gauge-values">—</span>
        <span class="wv-gauge-badge" id="gauge-badge"></span>
      </div>
      <div class="wv-gauge-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" id="gauge-track">
        <div class="wv-gauge-fill" id="gauge-fill"></div>
      </div>
      <div class="wv-gauge-sub" id="gauge-sub"></div>
    </div>`;

  const values = el.querySelector<HTMLElement>('#gauge-values')!;
  const badge = el.querySelector<HTMLElement>('#gauge-badge')!;
  const track = el.querySelector<HTMLElement>('#gauge-track')!;
  const fill = el.querySelector<HTMLElement>('#gauge-fill')!;
  const sub = el.querySelector<HTMLElement>('#gauge-sub')!;

  return {
    update(budget: BudgetState, currency: string) {
      const pct = Math.min(budget.percentOfIncluded * 100, 999);
      const pctDisplay = Math.round(Math.min(pct, 100));
      const fillPct = Math.min(pct, 100);

      values.textContent = `${formatCredits(budget.usedCredits)} / ${formatCredits(budget.includedCredits)} cr`;
      track.setAttribute('aria-valuenow', String(pctDisplay));
      track.setAttribute('aria-label', `${pctDisplay}% of included credits used`);
      fill.style.width = `${fillPct}%`;

      let pace = '';
      let severity = 'ok';
      if (pct >= 100) {
        severity = 'err';
        pace = `Over — ${formatMoney(budget.usedCost, currency)} spent`;
      } else if (pct >= 80) {
        severity = 'warn';
        pace = `${pctDisplay}% — watch spend`;
      } else {
        pace = `${pctDisplay}%`;
      }

      badge.textContent = pace;
      badge.dataset.severity = severity;
      fill.dataset.severity = severity;

      if (budget.monthly && budget.monthly > 0) {
        sub.textContent = `$${budget.usedCost.toFixed(2)} of $${budget.monthly.toFixed(2)} budget (${Math.round(budget.percentOfBudget * 100)}%)`;
      } else {
        sub.textContent = '';
      }
    },
  };
}
