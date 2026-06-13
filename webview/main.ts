import './styles/reset.css';
import './styles/theme.css';
import './styles/dashboard.css';

import { onMessage, post } from './api';
import { state, setState, subscribe } from './store';
import { applyTheme } from './charts/echarts';
import { mountDailyBars } from './charts/dailyBars';
import { mountHeatmap } from './charts/heatmap';
import { mountModelBreakdown } from './charts/modelBreakdown';
import { mountSankey } from './charts/sankey';
import { mountKpiCards } from './components/KpiCards';
import { mountFilterBar } from './components/FilterBar';
import { mountStatusBanner } from './components/StatusBanner';
import { mountEmptyState } from './components/EmptyState';
import { mountSpendGauge } from './components/SpendGauge';

const WEEVIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" fill="currentColor" aria-hidden="true" class="wv-brand-logo">
  <path d="M30 28 C18 28 8 37 8 48 C8 59 18 68 30 68 C36 68 41 65 45 61 L52 61 C55 66 61 70 68 70 C80 70 90 62 90 52 C90 46 87 40 82 36 C83 34 84 32 84 30 C84 20 76 12 66 12 C60 12 55 15 52 19 L48 19 C45 16 41 14 36 13 C34 28 30 28 30 28Z"/>
  <ellipse cx="25" cy="48" rx="12" ry="8"/>
  <ellipse cx="72" cy="50" rx="14" ry="10"/>
</svg>`;

const compact = document.body.dataset.compact === '1';
setState({ compact });
applyTheme();

const app = document.getElementById('app')!;

if (compact) {
  mountCompact(app);
} else {
  mountDashboard(app);
}

// ── Message routing ─────────────────────────────────────────────────────────

onMessage((msg) => {
  if (msg.type === 'snapshot') {
    setState({ snapshot: msg.payload, compact: msg.compact });
  } else if (msg.type === 'theme') {
    applyTheme();
    if (state.snapshot) setState({ snapshot: state.snapshot });
  }
});

post({ type: 'ready' });

// ── Full dashboard ──────────────────────────────────────────────────────────

function mountDashboard(root: HTMLElement): void {
  root.innerHTML = `
    <div class="wv-dashboard">
      <header class="wv-header">
        <div class="wv-brand">
          ${WEEVIL_SVG}
          <div>
            <div class="wv-brand-name">Weevil</div>
            <div class="wv-brand-tagline">A little nosey about your Copilot spend.</div>
          </div>
        </div>
        <div id="status-banner"></div>
      </header>
      <div id="filter-bar"></div>
      <div id="empty-state"></div>
      <div id="content" style="display:none">
        <div id="kpi-cards"></div>
        <div id="spend-gauge"></div>
        <section class="wv-chart-section" aria-label="Daily usage">
          <div class="wv-chart-header">
            <span class="wv-chart-title">
              <i class="codicon codicon-graph"></i> Daily usage — last 30 days
            </span>
          </div>
          <div class="wv-chart-body" id="chart-daily" role="img" aria-label="Daily usage bar chart"></div>
        </section>
        <section class="wv-chart-section" id="heatmap-section" aria-label="Activity heatmap" style="display:none">
          <div class="wv-chart-header">
            <span class="wv-chart-title">
              <i class="codicon codicon-calendar"></i> Activity — last 12 weeks
            </span>
          </div>
          <div class="wv-chart-body heatmap" id="chart-heatmap" role="img" aria-label="Activity heatmap"></div>
        </section>
        <div class="wv-chart-row">
          <section class="wv-chart-section" aria-label="Model breakdown">
            <div class="wv-chart-header">
              <span class="wv-chart-title">
                <i class="codicon codicon-symbol-method"></i> By model
              </span>
            </div>
            <div class="wv-chart-body mini" id="chart-models" role="img" aria-label="Usage by model"></div>
          </section>
          <section class="wv-chart-section wv-sankey-section" id="sankey-section" aria-label="Flow breakdown">
            <div class="wv-chart-header">
              <span class="wv-chart-title">
                <i class="codicon codicon-type-hierarchy-sub"></i> Flow breakdown
              </span>
            </div>
            <div class="wv-chart-body mini" id="chart-sankey" role="img" aria-label="Model to surface flow"></div>
          </section>
        </div>
      </div>
    </div>`;

  const banner = mountStatusBanner(document.getElementById('status-banner')!);
  const filterBar = mountFilterBar(document.getElementById('filter-bar')!);
  const emptyState = mountEmptyState(document.getElementById('empty-state')!);
  const kpis = mountKpiCards(document.getElementById('kpi-cards')!);
  const gauge = mountSpendGauge(document.getElementById('spend-gauge')!);
  const daily = mountDailyBars(document.getElementById('chart-daily')!);
  const heatmap = mountHeatmap(document.getElementById('chart-heatmap')!);
  const models = mountModelBreakdown(document.getElementById('chart-models')!);
  const sankey = mountSankey(document.getElementById('chart-sankey')!);
  const heatmapSection = document.getElementById('heatmap-section')!;
  const content = document.getElementById('content')!;

  const ro = new ResizeObserver(() => {
    daily.resize();
    heatmap.resize();
    models.resize();
    sankey.resize();
  });
  ro.observe(root);

  emptyState.update(false);

  subscribe((s) => {
    if (!s.snapshot) return;
    const isEmpty = s.snapshot.status.kind === 'empty';
    emptyState.update(isEmpty, s.snapshot.status.reason);
    content.style.display = isEmpty ? 'none' : '';

    banner.update(s.snapshot);
    filterBar.update(s.snapshot, s.metric);

    if (!isEmpty) {
      kpis.update(s.snapshot, s.metric);
      gauge.update(s.snapshot.budget, s.snapshot.currency);
      daily.update(s.snapshot);
      heatmap.update(s.snapshot);
      heatmapSection.style.display = s.snapshot.chartData.heatmap.max > 0 ? '' : 'none';
      models.update(s.snapshot, s.metric);
      sankey.update(s.snapshot);
    }
  });
}

// ── Compact sidebar ─────────────────────────────────────────────────────────

function mountCompact(root: HTMLElement): void {
  root.innerHTML = `
    <div class="wv-compact">
      <div class="wv-brand">
        ${WEEVIL_SVG}
        <div class="wv-brand-name">Weevil</div>
      </div>
      <div id="status-banner"></div>
      <div id="compact-gauge"></div>
      <div class="wv-compact-summary" id="compact-summary" aria-label="Usage summary"></div>
      <button class="wv-open-btn" id="open-dashboard">
        <i class="codicon codicon-graph"></i> Open dashboard
      </button>
    </div>`;

  const banner = mountStatusBanner(document.getElementById('status-banner')!);
  const gauge = mountSpendGauge(document.getElementById('compact-gauge')!);
  const summary = document.getElementById('compact-summary')!;
  const openBtn = document.getElementById('open-dashboard')!;

  openBtn.addEventListener('click', () => {
    post({ type: 'command', id: 'openDashboard' });
  });

  subscribe((s) => {
    if (!s.snapshot) return;
    banner.update(s.snapshot);
    gauge.update(s.snapshot.budget, s.snapshot.currency);

    const { today, budget, forecast, currency } = s.snapshot;
    const rows: [string, string][] = [
      ['Today', fmtCost(today.cost, currency)],
      ['Month-to-date', fmtCost(budget.usedCost, currency)],
    ];
    if (forecast.basis !== 'insufficient-data') {
      rows.push(['Projected', fmtCost(forecast.projectedCost, currency)]);
    }

    summary.innerHTML = '';
    for (const [k, v] of rows) {
      const row = document.createElement('div');
      row.className = 'wv-compact-row';
      const keyEl = document.createElement('span');
      keyEl.className = 'wv-compact-key';
      keyEl.textContent = k;
      const valEl = document.createElement('span');
      valEl.className = 'wv-compact-val';
      valEl.textContent = v;
      row.appendChild(keyEl);
      row.appendChild(valEl);
      summary.appendChild(row);
    }
  });
}

function fmtCost(cost: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cost);
  } catch {
    return `${currency} ${cost.toFixed(2)}`;
  }
}
