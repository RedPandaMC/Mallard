import './styles/reset.css';
import './styles/theme.css';
import './styles/dashboard.css';

import { onMessage, post } from './api';
import { state, setState, subscribe } from './store';
import { applyTheme } from './charts/echarts';
import { mountUsageOverTime } from './charts/usageOverTime';
import { mountModelBreakdown } from './charts/modelBreakdown';
import { mountRepoBreakdown } from './charts/repoBreakdown';
import { mountKpiCards } from './components/KpiCards';
import { mountGranularityTabs } from './components/GranularityTabs';
import { mountFilterBar } from './components/FilterBar';
import { mountStatusBanner } from './components/StatusBanner';
import { mountTipsPanel } from './components/TipsPanel';

const WEEVIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" fill="currentColor" aria-hidden="true" class="wv-brand-logo">
  <ellipse cx="17.5" cy="14" rx="9" ry="6.5"/>
  <circle cx="8" cy="13.5" r="4.5"/>
  <ellipse cx="2.2" cy="13.5" rx="3.2" ry="1.1"/>
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

// ── Message routing ────────────────────────────────────────────────────────

onMessage((msg) => {
  if (msg.type === 'snapshot') {
    setState({ snapshot: msg.payload, granularity: msg.granularity, compact: msg.compact });
  } else if (msg.type === 'theme') {
    applyTheme();
    // charts pick up new theme on next update via setOption; force redraw if snapshot ready
    if (state.snapshot) setState({ snapshot: state.snapshot });
  } else if (msg.type === 'tip') {
    setState({ tip: msg.payload });
  }
});

// Signal that the webview is ready
post({ type: 'ready' });

// ── Full dashboard ─────────────────────────────────────────────────────────

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
      <div id="kpi-cards"></div>
      <section class="wv-chart-section" aria-label="Usage over time">
        <div class="wv-chart-header">
          <span class="wv-chart-title">Usage over time</span>
          <div id="gran-tabs"></div>
        </div>
        <div class="wv-chart-body" id="chart-over-time" role="img" aria-label="Usage over time area chart"></div>
      </section>
      <div class="wv-chart-row">
        <section class="wv-chart-section" aria-label="Model breakdown">
          <div class="wv-chart-header">
            <span class="wv-chart-title">By model</span>
          </div>
          <div class="wv-chart-body mini" id="chart-models" role="img" aria-label="Usage by model donut chart"></div>
        </section>
        <section class="wv-chart-section" aria-label="Repository breakdown">
          <div class="wv-chart-header">
            <span class="wv-chart-title">By repo</span>
          </div>
          <div class="wv-chart-body mini" id="chart-repos" role="img" aria-label="Usage by repository bar chart"></div>
        </section>
      </div>
      <div id="tips-panel"></div>
    </div>`;

  const banner = mountStatusBanner(document.getElementById('status-banner')!);
  const filterBar = mountFilterBar(document.getElementById('filter-bar')!);
  const kpis = mountKpiCards(document.getElementById('kpi-cards')!);
  const tabs = mountGranularityTabs(document.getElementById('gran-tabs')!, (g) => {
    setState({ granularity: g });
  });
  const overTime = mountUsageOverTime(document.getElementById('chart-over-time')!);
  const models = mountModelBreakdown(document.getElementById('chart-models')!);
  const repos = mountRepoBreakdown(document.getElementById('chart-repos')!);
  const tips = mountTipsPanel(document.getElementById('tips-panel')!);

  // Wire ResizeObserver for charts
  const ro = new ResizeObserver(() => {
    overTime.resize();
    models.resize();
    repos.resize();
  });
  ro.observe(root);

  subscribe((s) => {
    if (s.snapshot) {
      banner.update(s.snapshot);
      filterBar.update(s.snapshot, s.metric);
      kpis.update(s.snapshot, s.metric);
      tabs.update(s.granularity);
      overTime.update(s.snapshot, s.granularity, s.metric);
      models.update(s.snapshot, s.metric);
      repos.update(s.snapshot, s.metric);
    }
    tips.update(s.tip);
  });

  // Seed tip request
  post({ type: 'requestTip' });
}

// ── Compact sidebar ────────────────────────────────────────────────────────

function mountCompact(root: HTMLElement): void {
  root.innerHTML = `
    <div class="wv-compact">
      <div class="wv-brand">
        ${WEEVIL_SVG}
        <div class="wv-brand-name">Weevil</div>
      </div>
      <div id="status-banner"></div>
      <div class="wv-compact-summary" id="kpi-compact" aria-label="Usage summary"></div>
      <button class="wv-open-btn" id="open-dashboard">Open Dashboard</button>
    </div>`;

  const banner = mountStatusBanner(document.getElementById('status-banner')!);
  const summary = document.getElementById('kpi-compact')!;
  const openBtn = document.getElementById('open-dashboard')!;

  openBtn.addEventListener('click', () => {
    post({ type: 'command', id: 'openDashboard' });
  });

  subscribe((s) => {
    if (!s.snapshot) return;
    banner.update(s.snapshot);
    const { current, budget, forecast, currency } = s.snapshot;

    const rows: [string, string][] = [
      [current.label, formatVal(current, s.metric, currency)],
      ['Month-to-date', new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(budget.usedCost)],
    ];

    if (forecast.basis !== 'insufficient-data') {
      rows.push(['Projected', new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(forecast.projectedCost)]);
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

function formatVal(
  current: { cost: number; credits: number; tokens: number },
  metric: string,
  currency: string,
): string {
  if (metric === 'credits') return `${Math.round(current.credits)} cr`;
  if (metric === 'tokens') {
    const n = current.tokens;
    return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M tok` : n >= 1000 ? `${(n / 1000).toFixed(1)}k tok` : `${n} tok`;
  }
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(current.cost);
}
