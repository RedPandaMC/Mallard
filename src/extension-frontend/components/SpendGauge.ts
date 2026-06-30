import { BudgetState } from '../../extension-backend/domain/types';
import { formatCredits, formatMoney } from '../../extension-backend/domain/format';

export interface SpendGaugeHandle {
  update(budget: BudgetState, currency: string): void;
}

/** Total segments and the scale ceiling: the bar runs to 120% so a budget
 *  overage still has room to read on the right. 100% lands at SEG_OVER. */
const SEGMENTS = 30;
const SCALE_MAX = 120;
const SEG_OVER = Math.round((100 / SCALE_MAX) * SEGMENTS);

export function mountSpendGauge(el: HTMLElement): SpendGaugeHandle {
  const segs = Array.from(
    { length: SEGMENTS },
    (_, i) => `<div class="wv-gauge-seg" data-i="${i}"></div>`,
  ).join('');

  el.innerHTML = `
    <div class="wv-gauge-section" id="gauge-section">
      <div class="wv-gauge-header">
        <span class="wv-gauge-label">Credits this month</span>
        <span class="wv-gauge-badge" id="gauge-badge"></span>
      </div>
      <div class="wv-gauge-readout">
        <span class="wv-gauge-pct" id="gauge-pct">—</span>
        <span class="wv-gauge-pct-sign">%</span>
      </div>
      <div class="wv-gauge-segments" role="progressbar" aria-valuemin="0" aria-valuemax="100" id="gauge-track">
        ${segs}
      </div>
      <div class="wv-gauge-scale">
        <span>0%</span><span id="gauge-cap">cap</span><span>${SCALE_MAX}%</span>
      </div>
      <div class="wv-gauge-sub" id="gauge-sub"></div>
    </div>`;

  const section = el.querySelector<HTMLElement>('#gauge-section')!;
  const badge = el.querySelector<HTMLElement>('#gauge-badge')!;
  const pctEl = el.querySelector<HTMLElement>('#gauge-pct')!;
  const track = el.querySelector<HTMLElement>('#gauge-track')!;
  const cap = el.querySelector<HTMLElement>('#gauge-cap')!;
  const sub = el.querySelector<HTMLElement>('#gauge-sub')!;
  const segEls = Array.from(el.querySelectorAll<HTMLElement>('.wv-gauge-seg'));

  return {
    update(budget: BudgetState, currency: string) {
      const pct = Math.min(budget.percentOfIncluded * 100, 999);
      const pctDisplay = Math.round(pct);
      const lit = Math.round((Math.min(pct, SCALE_MAX) / SCALE_MAX) * SEGMENTS);

      let severity = 'ok';
      let pace = `${pctDisplay}% used`;
      if (pct >= 100) {
        severity = 'err';
        pace = 'over';
      } else if (pct >= 80) {
        severity = 'warn';
        pace = 'warn';
      } else {
        pace = 'ok';
      }

      pctEl.textContent = String(pctDisplay);
      badge.textContent = pace;
      section.dataset.severity = severity;
      track.setAttribute('aria-valuenow', String(Math.min(pctDisplay, 100)));
      track.setAttribute(
        'aria-label',
        `${pctDisplay}% of included credits used (${formatCredits(budget.usedCredits)} of ${formatCredits(budget.includedCredits)} credits)`,
      );

      // Light segments up to `lit`; segments past the 100% mark glow red.
      const over = 'var(--w-sev-over)';
      segEls.forEach((seg, i) => {
        const on = i < lit;
        seg.classList.toggle('wv-gauge-seg--on', on);
        seg.style.background = on ? (i >= SEG_OVER ? over : 'var(--sev)') : '';
        // staggered rise, matching the canvas gauge
        seg.style.animationDelay = on ? `${(i * 0.012).toFixed(3)}s` : '';
      });

      cap.textContent = `cap ${formatCredits(budget.includedCredits)} cr`;

      if (budget.monthly && budget.monthly > 0) {
        sub.textContent = `${formatMoney(budget.usedCost, currency)} of ${formatMoney(budget.monthly, currency)} budget · ${Math.round(budget.percentOfBudget * 100)}%`;
      } else {
        sub.textContent = `${formatMoney(budget.usedCost, currency)} spent`;
      }
    },
  };
}
