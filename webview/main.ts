import './styles/reset.css';
import './styles/theme.css';
import './styles/dashboard.css';

import { onMessage, post } from './api';
import { state, setState, subscribe } from './store';
import { lazyChart } from './lazyMount';
import { mountLayout } from './layout';
import { DashboardLayout, DEFAULT_DASHBOARD_LAYOUT } from '../src/domain/types';
import { applyTheme } from './charts/echarts';
import { mountDailyBars } from './charts/dailyBars';
import { mountHeatmap } from './charts/heatmap';
import { mountModelBreakdown } from './charts/modelBreakdown';
import { mountSankey } from './charts/sankey';
import { mountCategoryBreakdown } from './charts/categoryBreakdown';
import { mountKpiCards } from './components/KpiCards';
import { mountFilterBar } from './components/FilterBar';
import { mountGitHubBillingStrip } from './components/GitHubBillingStrip';
import { mountStatusBanner } from './components/StatusBanner';
import { mountEmptyState } from './components/EmptyState';
import { mountSpendGauge } from './components/SpendGauge';
import { mountAlertConfigPanel } from './components/AlertConfigPanel';
import { mountRestrictionBanner } from './components/RestrictionBanner';

const LOGO_SRC = document.body.dataset.logo ?? '';

applyTheme();
mountDashboard(document.getElementById('app')!);

// ── Message routing ─────────────────────────────────────────────────────────

onMessage((msg) => {
  if (msg.type === 'snapshot') {
    setState({ snapshot: msg.payload });
  } else if (msg.type === 'config') {
    setState({ config: msg.value });
  } else if (msg.type === 'layout') {
    setState({ layout: msg.value });
  } else if (msg.type === 'restriction') {
    setState({ restriction: msg.value });
  } else if (msg.type === 'theme') {
    applyTheme();
    if (state().snapshot) setState({ snapshot: state().snapshot });
  }
});

post({ type: 'ready' });

// ── Full dashboard ──────────────────────────────────────────────────────────

function panelHtml(
  id: string,
  icon: string,
  title: string,
  bodyId: string,
  ariaLabel: string,
  bodyClass = '',
): string {
  return `
    <section class="wv-chart-section" data-panel="${id}" aria-label="${title}">
      <div class="wv-chart-header">
        <span class="wv-chart-title"><i class="codicon ${icon}"></i> ${title}</span>
      </div>
      <div class="wv-chart-body ${bodyClass}" id="${bodyId}" role="img" aria-label="${ariaLabel}"></div>
    </section>`;
}

function mountDashboard(root: HTMLElement): void {
  root.innerHTML = `
    <div class="wv-dashboard">
      <header class="wv-header">
        <div class="wv-brand">
          <img class="wv-brand-logo" src="${LOGO_SRC}" alt="" aria-hidden="true" />
          <div>
            <div class="wv-brand-name">Weevil</div>
            <div class="wv-brand-meta">Copilot spend · instrument</div>
          </div>
        </div>
        <div class="wv-header-right">
          <div id="status-banner"></div>
        </div>
      </header>
      <div id="filter-bar"></div>
      <div id="restriction-banner"></div>
      <div id="alert-config"></div>
      <div id="empty-state"></div>
      <div id="content" hidden>
        <div id="kpi-cards"></div>
        <div id="gh-billing-strip"></div>
        <div id="spend-gauge"></div>
        <div class="wv-analysis-bar">
          <span class="wv-analysis-title">Analysis</span>
          <span class="wv-analysis-actions">
            <button class="wv-btn wv-btn--sm" id="layout-reset" hidden>
              <i class="codicon codicon-discard"></i> Reset layout
            </button>
            <button class="wv-btn wv-btn--sm" id="layout-edit" aria-pressed="false">
              <i class="codicon codicon-edit"></i> Edit layout
            </button>
          </span>
        </div>
        <div class="wv-charts-grid" id="charts-grid">
          ${panelHtml('daily', 'codicon-graph', 'Daily usage (last 30 days)', 'chart-daily', 'Daily usage bar chart')}
          ${panelHtml('heatmap', 'codicon-calendar', 'Activity (last 12 weeks)', 'chart-heatmap', 'Activity heatmap', 'heatmap')}
          ${panelHtml('models', 'codicon-symbol-method', 'By model', 'chart-models', 'Usage by model', 'mini')}
          ${panelHtml('sankey', 'codicon-type-hierarchy-sub', 'Flow breakdown', 'chart-sankey', 'Model to surface flow', 'mini')}
          ${panelHtml('category', 'codicon-pie-chart', 'Spend by cost type', 'chart-category', 'Spend by cost type', 'mini')}
        </div>
      </div>
    </div>`;

  const banner = mountStatusBanner(document.getElementById('status-banner')!);
  const restrictBanner = mountRestrictionBanner(document.getElementById('restriction-banner')!);
  const filterBar = mountFilterBar(document.getElementById('filter-bar')!);
  const emptyState = mountEmptyState(document.getElementById('empty-state')!);
  const kpis = mountKpiCards(document.getElementById('kpi-cards')!);
  const ghStrip = mountGitHubBillingStrip(document.getElementById('gh-billing-strip')!);
  const gauge = mountSpendGauge(document.getElementById('spend-gauge')!);
  const dailyEl = document.getElementById('chart-daily')!;
  const heatmapEl = document.getElementById('chart-heatmap')!;
  const modelsEl = document.getElementById('chart-models')!;
  const sankeyEl = document.getElementById('chart-sankey')!;
  const categoryEl = document.getElementById('chart-category')!;
  const daily = lazyChart(dailyEl, () => mountDailyBars(dailyEl));
  const heatmap = lazyChart(heatmapEl, () => mountHeatmap(heatmapEl));
  const models = lazyChart(modelsEl, () => mountModelBreakdown(modelsEl));
  const sankey = lazyChart(sankeyEl, () => mountSankey(sankeyEl));
  const category = lazyChart(categoryEl, () => mountCategoryBreakdown(categoryEl));
  const alertConfig = mountAlertConfigPanel(document.getElementById('alert-config')!);
  const content = document.getElementById('content')!;

  // Section elements (the dockable/resizable panels) keyed by panel id.
  const section = (id: string) =>
    document.querySelector<HTMLElement>(`.wv-chart-section[data-panel="${id}"]`)!;
  const sections: Record<string, HTMLElement> = {
    daily: section('daily'),
    heatmap: section('heatmap'),
    models: section('models'),
    sankey: section('sankey'),
    category: section('category'),
  };

  const resizeAll = () => {
    daily.resize();
    heatmap.resize();
    models.resize();
    sankey.resize();
    category.resize();
  };

  // Dynamic scaling + docking: the layout manager reorders, resizes (span), and
  // shows/hides panels; every change is persisted via setLayout.
  const layoutMgr = mountLayout(document.getElementById('charts-grid')!, sections, (next) => {
    post({ type: 'setLayout', value: next });
    requestAnimationFrame(resizeAll);
  });
  layoutMgr.apply(state().layout);

  let editing = false;
  const editBtn = document.getElementById('layout-edit')!;
  const resetBtn = document.getElementById('layout-reset')!;
  editBtn.addEventListener('click', () => {
    editing = !editing;
    layoutMgr.setEditMode(editing);
    editBtn.setAttribute('aria-pressed', String(editing));
    resetBtn.hidden = !editing;
    requestAnimationFrame(resizeAll);
  });
  resetBtn.addEventListener('click', () => {
    post({ type: 'setLayout', value: DEFAULT_DASHBOARD_LAYOUT });
  });

  alertConfig.update(state().config);

  let resizeFrame: number | undefined;
  const ro = new ResizeObserver(() => {
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(resizeAll);
  });
  for (const el of Object.values(sections)) ro.observe(el);

  emptyState.update(false);

  let appliedLayout: DashboardLayout | null = null;

  subscribe((s) => {
    alertConfig.update(s.config);
    if (s.layout !== appliedLayout) {
      appliedLayout = s.layout;
      layoutMgr.apply(s.layout);
      requestAnimationFrame(resizeAll);
    }
    if (!s.snapshot) return;
    const isEmpty = s.snapshot.status.kind === 'empty';
    emptyState.update(isEmpty, s.snapshot.status.reason);
    content.hidden = isEmpty;

    banner.update(s.snapshot);
    filterBar.update(s.snapshot, s.metric);
    restrictBanner.update(s.restriction);

    // Make the latest snapshot available to the Monaco editor so its live
    // preview can re-evaluate rules as the user types.
    (window as unknown as { __wvSnapshot?: typeof s.snapshot }).__wvSnapshot = s.snapshot;

    if (!isEmpty) {
      const snapshot = s.snapshot;
      const metric = s.metric;
      kpis.update(snapshot, metric);
      ghStrip.update(snapshot);
      gauge.update(snapshot.budget, snapshot.currency);
      daily.render((c) => c.update(snapshot));
      // Data-availability hiding is independent of the user's layout choice.
      sections['heatmap']!.classList.toggle('wv-no-data', snapshot.chartData.heatmap.max <= 0);
      heatmap.render((c) => c.update(snapshot));
      models.render((c) => c.update(snapshot, metric));
      sankey.render((c) => c.update(snapshot));
      sections['category']!.classList.toggle(
        'wv-no-data',
        !snapshot.chartData.categoryBreakdown.available,
      );
      category.render((c) => c.update(snapshot));
    }
  });
}
