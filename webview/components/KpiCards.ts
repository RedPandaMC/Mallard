import { Metric, PaceStatus, UsageSnapshot } from '../../src/model/types';
import { formatCredits, formatMetric, formatMoney, formatTokens } from '../../src/model/format';

export interface KpiCardsHandle {
  update(snapshot: UsageSnapshot, metric: Metric): void;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function paceLabel(p: PaceStatus): string {
  switch (p) {
    case 'under': return 'Under budget';
    case 'on-track': return 'On track';
    case 'warning': return 'Watch spend';
    case 'over': return 'Over budget';
    default: return '';
  }
}

export function mountKpiCards(el: HTMLElement): KpiCardsHandle {
  el.innerHTML = `
    <div class="wv-kpi-grid" role="list">
      <article class="wv-kpi-card" role="listitem" aria-label="Current period">
        <div class="wv-kpi-label" id="kpi-scope-lbl">Scope</div>
        <div class="wv-kpi-value" aria-labelledby="kpi-scope-lbl" id="kpi-scope-val">—</div>
        <div class="wv-kpi-sub" id="kpi-scope-sub"></div>
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
      <article class="wv-kpi-card" role="listitem" aria-label="Budget pace" id="kpi-budget-card">
        <div class="wv-kpi-label">Budget</div>
        <div class="wv-kpi-value" id="kpi-budget-val">—</div>
        <div class="wv-kpi-badge" id="kpi-budget-badge" data-pace="no-budget"></div>
      </article>
      <article class="wv-kpi-card" role="listitem" aria-label="Top model">
        <div class="wv-kpi-label">Top model</div>
        <div class="wv-kpi-value wv-kpi-value--sm" id="kpi-model-val">—</div>
        <div class="wv-kpi-sub" id="kpi-model-sub"></div>
      </article>
      <article class="wv-kpi-card" role="listitem" aria-label="Top repository" id="kpi-repo-card">
        <div class="wv-kpi-label">Top repo</div>
        <div class="wv-kpi-value wv-kpi-value--sm" id="kpi-repo-val">—</div>
        <div class="wv-kpi-sub" id="kpi-repo-sub"></div>
      </article>
    </div>`;

  function q<T extends HTMLElement>(id: string) {
    return el.querySelector<T>(`#${id}`)!;
  }

  const scopeLbl = q('kpi-scope-lbl');
  const scopeVal = q('kpi-scope-val');
  const scopeSub = q('kpi-scope-sub');
  const mtdVal = q('kpi-mtd-val');
  const mtdSub = q('kpi-mtd-sub');
  const projVal = q('kpi-proj-val');
  const projSub = q('kpi-proj-sub');
  const budgetCard = q('kpi-budget-card');
  const budgetVal = q('kpi-budget-val');
  const budgetBadge = q('kpi-budget-badge');
  const modelVal = q('kpi-model-val');
  const modelSub = q('kpi-model-sub');
  const repoCard = q('kpi-repo-card');
  const repoVal = q('kpi-repo-val');
  const repoSub = q('kpi-repo-sub');

  return {
    update(s: UsageSnapshot, metric: Metric) {
      const { currency, budget, forecast, topModels, topRepos, current } = s;

      // Scope card
      scopeLbl.textContent = current.label;
      scopeVal.textContent = formatMetric(
        metric === 'cost' ? current.cost : metric === 'credits' ? current.credits : current.tokens,
        metric,
        currency,
      );
      const todayAgg = s.aggregates.day.find((a) => a.bucketKey === todayKey());
      if (metric !== 'cost' && todayAgg) {
        scopeSub.textContent = `≈ ${formatMoney(todayAgg.cost, currency)} today`;
      } else {
        scopeSub.textContent = `${formatCredits(current.credits)} cr · ${formatTokens(current.tokens)} tok`;
      }

      // MTD
      mtdVal.textContent = formatMetric(
        metric === 'cost' ? budget.usedCost : metric === 'credits' ? budget.usedCredits : budget.usedCredits * 1000,
        metric,
        currency,
      );
      mtdSub.textContent = `${formatCredits(budget.usedCredits)} cr`;

      // Projected
      if (forecast.basis === 'insufficient-data') {
        projVal.textContent = '—';
        projSub.textContent = 'Not enough data yet';
      } else {
        projVal.textContent = formatMoney(forecast.projectedCost, currency);
        const lo = formatMoney(forecast.low * s.pricePerCredit, currency);
        const hi = formatMoney(forecast.high * s.pricePerCredit, currency);
        projSub.textContent = `Range: ${lo} – ${hi}`;
      }

      // Budget
      if (budget.monthly !== null && budget.monthly > 0) {
        budgetCard.style.display = '';
        budgetVal.textContent = `${Math.round(budget.percentOfBudget)}%`;
        budgetBadge.textContent = paceLabel(budget.pace);
        budgetBadge.dataset.pace = budget.pace;
        budgetBadge.setAttribute('aria-label', paceLabel(budget.pace));
      } else {
        budgetCard.style.display = 'none';
      }

      // Top model
      if (topModels.length) {
        const m = topModels[0];
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

      // Top repo
      if (topRepos.length) {
        repoCard.style.display = '';
        const r = topRepos[0];
        repoVal.textContent = r.key;
        repoSub.textContent = formatMetric(
          metric === 'cost' ? r.cost : metric === 'credits' ? r.credits : r.tokens,
          metric,
          currency,
        );
      } else {
        repoCard.style.display = 'none';
      }
    },
  };
}
