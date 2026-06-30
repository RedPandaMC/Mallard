import { Metric, UsageSnapshot } from '../../src/extension/domain/types';
import { formatCredits, formatMetric, formatMoney, formatTokens } from '../../src/extension/domain/format';

export interface KpiCardsHandle {
  update(snapshot: UsageSnapshot, metric: Metric): void;
}

export function mountKpiCards(el: HTMLElement): KpiCardsHandle {
  el.innerHTML = `
    <div class="wv-kpi-grid" role="list">
      <article class="wv-kpi-card" role="listitem" aria-label="Today">
        <div class="wv-kpi-label">Today</div>
        <div class="wv-kpi-value" id="kpi-today-val">—</div>
        <div class="wv-kpi-sub" id="kpi-today-sub"></div>
      </article>
      <article class="wv-kpi-card" role="listitem" aria-label="Month to date">
        <div class="wv-kpi-label">This month</div>
        <div class="wv-kpi-value" id="kpi-mtd-val">—</div>
        <div class="wv-kpi-sub" id="kpi-mtd-sub"></div>
      </article>
      <article class="wv-kpi-card" role="listitem" aria-label="Projected month-end spend">
        <div class="wv-kpi-label">Projected</div>
        <div class="wv-kpi-value" id="kpi-proj-val">—</div>
        <div class="wv-kpi-sub" id="kpi-proj-sub"></div>
      </article>
      <article class="wv-kpi-card" role="listitem" aria-label="Top model">
        <div class="wv-kpi-label">Top model</div>
        <div class="wv-kpi-value wv-kpi-value--sm" id="kpi-model-val">—</div>
        <div class="wv-kpi-sub" id="kpi-model-sub"></div>
      </article>
    </div>`;

  function q<T extends HTMLElement>(id: string) {
    return el.querySelector<T>(`#${id}`)!;
  }

  const todayVal = q('kpi-today-val');
  const todaySub = q('kpi-today-sub');
  const mtdVal = q('kpi-mtd-val');
  const mtdSub = q('kpi-mtd-sub');
  const projVal = q('kpi-proj-val');
  const projSub = q('kpi-proj-sub');
  const modelVal = q('kpi-model-val');
  const modelSub = q('kpi-model-sub');

  return {
    update(s: UsageSnapshot, metric: Metric) {
      const { currency, budget, forecast, topModels, today } = s;

      // Today
      todayVal.textContent = formatMetric(
        metric === 'cost' ? today.cost : metric === 'credits' ? today.credits : today.tokens,
        metric,
        currency,
      );
      todaySub.textContent = `${formatCredits(today.credits)} cr · ${formatTokens(today.tokens)} tok`;

      // MTD
      mtdVal.textContent = formatMetric(
        metric === 'cost'
          ? budget.usedCost
          : metric === 'credits'
            ? budget.usedCredits
            : budget.usedCredits * 1000,
        metric,
        currency,
      );
      mtdSub.textContent = `${formatCredits(budget.usedCredits)} cr`;

      // Projected
      if (forecast.basis === 'insufficient-data') {
        projVal.textContent = '—';
        projSub.textContent = 'Need 3+ days of data';
      } else {
        projVal.textContent = formatMoney(forecast.projectedCost, currency);
        const lo = formatMoney(forecast.low * s.pricePerCredit, currency);
        const hi = formatMoney(forecast.high * s.pricePerCredit, currency);
        projSub.textContent = `${lo} – ${hi}`;
      }

      // Top model
      if (topModels.length) {
        const m = topModels[0]!;
        modelVal.textContent = m.key;
        modelSub.textContent = formatMetric(
          metric === 'cost' ? m.cost : metric === 'credits' ? m.credits : m.tokens,
          metric,
          currency,
        );
      } else {
        modelVal.textContent = '—';
        modelSub.textContent = '';
      }
    },
  };
}
