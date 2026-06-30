import './styles/fonts.css';
import './styles/reset.css';
import './styles/theme.css';
import './styles/dashboard.css';

import { onMessage, post } from './api';
import { state, setState, subscribe } from './store';
import {
  dailyBarsChanged,
  heatmapChanged,
  modelBreakdownChanged,
  categoryBreakdownChanged,
  hourlyChanged,
} from './chartDiff';
import { lazyChart } from './lazyMount';
import { mountLayout } from './layout';
import {
  CategoryBreakdownData,
  DailyBarsData,
  DashboardLayout,
  DEFAULT_DASHBOARD_LAYOUT,
  HeatmapData,
  HourlyTimelineData,
  ModelBreakdownData,
} from '../extension-backend/domain/types';
import { applyTheme } from './charts/echarts';
import { applyPalette } from './theme';
import { mountDailyBars } from './charts/dailyBars';
import { mountHeatmap } from './charts/heatmap';
import { mountModelBreakdown } from './charts/modelBreakdown';
import { mountSankey } from './charts/sankey';
import { mountCategoryBreakdown } from './charts/categoryBreakdown';
import { mountCumulativeArea } from './charts/cumulativeArea';
import { mountWeekdayRadial } from './charts/weekdayRadial';
import { mountHourlyTimeline } from './charts/hourlyTimeline';
import { mountKpiCards } from './components/KpiCards';
import { mountFilterBar } from './components/FilterBar';
import { mountGitHubBillingStrip } from './components/GitHubBillingStrip';
import { mountStatusBanner } from './components/StatusBanner';
import { mountEmptyState } from './components/EmptyState';
import { mountSpendGauge } from './components/SpendGauge';
import { mountAlertConfigPanel } from './components/AlertConfigPanel';
import { mountRestrictionBanner } from './components/RestrictionBanner';
import { mountCurrencySelector } from './components/CurrencySelector';
import { formatCredits, formatMoney } from '../extension-backend/domain/format';

const LOGO_SRC = document.body.dataset.logo ?? '';

function setSrDesc(bodyId: string, text: string): void {
  const el = document.getElementById(`desc-${bodyId}`);
  if (el) el.textContent = text;
}

function applyForcedScheme(scheme: 'light' | 'dark' | null): void {
  document.body.removeAttribute('data-force-scheme');
  if (scheme) document.body.setAttribute('data-force-scheme', scheme);
}

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
    applyPalette(msg.palette, msg.kind);
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
  const descId = `desc-${bodyId}`;
  return `
    <section class="wv-chart-section" data-panel="${id}" aria-label="${title}">
      <div class="wv-chart-header">
        <span class="wv-chart-title"><i class="codicon ${icon}"></i> ${title}</span>
      </div>
      <p id="${descId}" class="wv-sr-only"></p>
      <div class="wv-chart-body ${bodyClass}" id="${bodyId}" role="img" aria-label="${ariaLabel}" aria-describedby="${descId}"></div>
    </section>`;
}

function mountDashboard(root: HTMLElement): void {
  root.innerHTML = `
    <div class="wv-dashboard">
      <header class="wv-header">
        <div class="wv-brand">
          <img class="wv-brand-logo" src="${LOGO_SRC}" alt="" aria-hidden="true" />
          <div>
            <div class="wv-brand-name">Mallard</div>
            <div class="wv-brand-meta">Copilot spend · instrument</div>
          </div>
        </div>
        <div class="wv-header-right">
          <div id="currency-selector" class="wv-currency-wrap"></div>
          <button class="wv-icon-btn" id="theme-toggle" aria-label="Toggle light/dark mode" title="Toggle light/dark mode">
            <i class="codicon codicon-color-mode"></i>
          </button>
          <div id="status-banner"></div>
        </div>
      </header>
      <div id="empty-state"></div>
      <div id="content" hidden>
        <div id="kpi-cards"></div>
        <div id="gh-billing-strip"></div>
        <div class="wv-gauge-row">
          <div id="spend-gauge"></div>
          <div id="restriction-banner"></div>
        </div>
        <div id="filter-bar"></div>
        <div id="alert-config"></div>
        <div class="wv-analysis-bar">
          <span class="wv-analysis-title">Analysis</span>
          <span class="wv-analysis-actions">
            <button class="wv-btn wv-btn--sm" id="clear-focus" hidden>
              <i class="codicon codicon-close"></i> Clear model focus
            </button>
            <button class="wv-btn wv-btn--sm" id="layout-save" hidden>
              <i class="codicon codicon-save"></i> Save to config
            </button>
            <button class="wv-btn wv-btn--sm" id="layout-reset" hidden>
              <i class="codicon codicon-discard"></i> Reset layout
            </button>
            <button class="wv-btn wv-btn--sm" id="layout-edit" aria-pressed="false">
              <i class="codicon codicon-edit"></i> Edit layout
            </button>
          </span>
        </div>
        <div class="wv-section-label">More views</div>
        <div class="wv-charts-grid" id="charts-grid">
          ${panelHtml('daily', 'codicon-graph', 'Daily usage (last 30 days)', 'chart-daily', 'Daily usage bar chart')}
          ${panelHtml('heatmap', 'codicon-calendar', 'Activity (last 12 weeks)', 'chart-heatmap', 'Activity heatmap', 'heatmap')}
          ${panelHtml('models', 'codicon-symbol-method', 'By model', 'chart-models', 'Usage by model', 'mini')}
          ${panelHtml('sankey', 'codicon-type-hierarchy-sub', 'Flow breakdown', 'chart-sankey', 'Model to surface flow', 'mini')}
          ${panelHtml('category', 'codicon-pie-chart', 'Spend by cost type', 'chart-category', 'Spend by cost type', 'mini')}
          ${panelHtml('cumulative', 'codicon-graph-line', 'Cumulative spend', 'chart-cumulative', 'Cumulative spend over the month', 'mini')}
          ${panelHtml('weekday', 'codicon-pulse', 'Usage by weekday', 'chart-weekday', 'Usage by weekday', 'mini')}
          ${panelHtml('hourly', 'codicon-clock', 'Usage by hour', 'chart-hourly', 'Usage by hour of day', 'mini')}
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
  const currencySelector = mountCurrencySelector(
    document.getElementById('currency-selector')!,
    (code) => setState({ selectedCurrency: code }),
  );

  // Theme toggle: cycles null → light → dark → null
  const themeToggleBtn = document.getElementById('theme-toggle')!;
  themeToggleBtn.addEventListener('click', () => {
    const current = state().forcedScheme;
    const next = current === null ? 'light' : current === 'light' ? 'dark' : null;
    setState({ forcedScheme: next });
    applyForcedScheme(next);
  });
  const dailyEl = document.getElementById('chart-daily')!;
  const heatmapEl = document.getElementById('chart-heatmap')!;
  const modelsEl = document.getElementById('chart-models')!;
  const sankeyEl = document.getElementById('chart-sankey')!;
  const categoryEl = document.getElementById('chart-category')!;
  const cumulativeEl = document.getElementById('chart-cumulative')!;
  const weekdayEl = document.getElementById('chart-weekday')!;
  const hourlyEl = document.getElementById('chart-hourly')!;
  const chartsGrid = document.getElementById('charts-grid')!;

  const daily = lazyChart(dailyEl, () => mountDailyBars(dailyEl));
  const heatmap = lazyChart(heatmapEl, () => mountHeatmap(heatmapEl));
  const models = lazyChart(modelsEl, () =>
    mountModelBreakdown(modelsEl, (label) => {
      const current = new Set(state().focusedModels);
      if (current.has(label)) current.delete(label);
      else current.add(label);
      const focusedModels: ReadonlySet<string> = current;
      setState({ focusedModels });
      const newFilter = { ...state().filter };
      if (current.size > 0) newFilter.models = [...current];
      else delete newFilter.models;
      setState({ filter: newFilter });
      post({ type: 'setFilter', value: newFilter });
    }),
  );
  const sankey = lazyChart(sankeyEl, () => mountSankey(sankeyEl));
  const category = lazyChart(categoryEl, () => mountCategoryBreakdown(categoryEl));
  const cumulative = lazyChart(cumulativeEl, () => mountCumulativeArea(cumulativeEl));
  const weekday = lazyChart(weekdayEl, () => mountWeekdayRadial(weekdayEl));
  const hourly = lazyChart(hourlyEl, () => mountHourlyTimeline(hourlyEl));
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
    cumulative: section('cumulative'),
    weekday: section('weekday'),
    hourly: section('hourly'),
  };

  const resizeAll = () => {
    daily.resize();
    heatmap.resize();
    models.resize();
    sankey.resize();
    category.resize();
    cumulative.resize();
    weekday.resize();
    hourly.resize();
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
  const saveBtn = document.getElementById('layout-save')!;
  const clearFocusBtn = document.getElementById('clear-focus')!;

  editBtn.addEventListener('click', () => {
    editing = !editing;
    layoutMgr.setEditMode(editing);
    editBtn.setAttribute('aria-pressed', String(editing));
    resetBtn.hidden = !editing;
    saveBtn.hidden = !editing;
    requestAnimationFrame(resizeAll);
  });

  resetBtn.addEventListener('click', () => {
    post({ type: 'setLayout', value: DEFAULT_DASHBOARD_LAYOUT });
    post({ type: 'setConfig', value: { dashboard: { panels: [] } } });
  });

  saveBtn.addEventListener('click', () => {
    const layout = state().layout;
    const panels = layout.map((p) => ({
      id: p.id,
      gridColumn: `span ${p.span}`,
      ...(p.hidden ? { hidden: true } : {}),
      ...(p.size && p.size !== 'normal' ? { size: p.size } : {}),
    }));
    post({ type: 'setConfig', value: { dashboard: { panels } } });
  });

  clearFocusBtn.addEventListener('click', () => {
    setState({ focusedModels: new Set<string>() });
    const newFilter = { ...state().filter };
    delete newFilter.models;
    setState({ filter: newFilter });
    post({ type: 'setFilter', value: newFilter });
  });

  // Ctrl/Cmd+Shift+E toggles edit mode.
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'E') {
      e.preventDefault();
      editBtn.click();
    }
  });

  alertConfig.update(state().config);

  let resizeFrame: number | undefined;
  const resizeObserver = new ResizeObserver(() => {
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(resizeAll);
  });
  for (const el of Object.values(sections)) resizeObserver.observe(el);

  emptyState.update(false);

  let appliedLayout: DashboardLayout | null = null;

  // Per-chart payload trackers for diff-based render skipping.
  // Charts only re-render when their specific input data changes.
  let prevDailyBars: DailyBarsData | undefined;
  let prevHeatmap: HeatmapData | undefined;
  let prevModelBreakdown: ModelBreakdownData | undefined;
  let prevFocusedModels: ReadonlySet<string> | undefined;
  let prevSankeyKey: string | undefined;
  let prevCategory: CategoryBreakdownData | undefined;
  let prevHourly: HourlyTimelineData | undefined;
  let prevMetric: string | undefined;

  subscribe((s) => {
    alertConfig.update(s.config);
    if (s.layout !== appliedLayout) {
      appliedLayout = s.layout;
      layoutMgr.apply(s.layout);
      requestAnimationFrame(resizeAll);
    }

    // Apply configurable column count to the CSS grid.
    const cols = Math.min(4, Math.max(1, s.config.dashboard?.columns ?? 2));
    chartsGrid.style.setProperty('--wv-cols', String(cols));

    // Model spotlight state.
    chartsGrid.dataset.focused = s.focusedModels.size > 0 ? 'true' : '';
    clearFocusBtn.hidden = s.focusedModels.size === 0;

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
      currencySelector.update(snapshot.fxRates, s.selectedCurrency);

      // dailyBars drives both the bar chart and the cumulative area view.
      if (dailyBarsChanged(prevDailyBars, snapshot.chartData.dailyBars)) {
        daily.render((c) => c.update(snapshot));
        cumulative.render((c) => c.update(snapshot));
        prevDailyBars = snapshot.chartData.dailyBars;
      }

      // heatmap data drives both the calendar heatmap and the weekday radial.
      const heatmapDirty = heatmapChanged(prevHeatmap, snapshot.chartData.heatmap);
      sections['heatmap']!.classList.toggle('wv-no-data', snapshot.chartData.heatmap.max <= 0);
      sections['weekday']!.classList.toggle('wv-no-data', snapshot.chartData.heatmap.max <= 0);
      if (heatmapDirty) {
        heatmap.render((c) => c.update(snapshot));
        weekday.render((c) => c.update(snapshot));
        prevHeatmap = snapshot.chartData.heatmap;
      }

      const focusedDirty = s.focusedModels !== prevFocusedModels;
      if (modelBreakdownChanged(prevModelBreakdown, snapshot.chartData.modelBreakdown) || metric !== prevMetric || focusedDirty) {
        const fm = s.focusedModels;
        models.render((c) => { c.setFocused(fm); c.update(snapshot, metric); });
        prevModelBreakdown = snapshot.chartData.modelBreakdown;
        prevFocusedModels = s.focusedModels;
      }

      // Sankey depends on links + dimension lists (no chartData slot).
      const sankeyKey = JSON.stringify([snapshot.sankeyLinks, snapshot.allModels, snapshot.allSurfaces]);
      if (sankeyKey !== prevSankeyKey) {
        sankey.render((c) => c.update(snapshot));
        prevSankeyKey = sankeyKey;
      }

      sections['category']!.classList.toggle(
        'wv-no-data',
        !snapshot.chartData.categoryBreakdown.available,
      );
      if (categoryBreakdownChanged(prevCategory, snapshot.chartData.categoryBreakdown)) {
        category.render((c) => c.update(snapshot));
        prevCategory = snapshot.chartData.categoryBreakdown;
      }

      if (hourlyChanged(prevHourly, snapshot.chartData.hourlyTimeline)) {
        hourly.render((c) => c.update(snapshot));
        prevHourly = snapshot.chartData.hourlyTimeline;
      }

      prevMetric = metric;
      updateSrDescriptions(snapshot);
    }
  });
}

function updateSrDescriptions(snapshot: import('../src/extension/domain/types').UsageSnapshot): void {
  const { dailyBars, heatmap, modelBreakdown, categoryBreakdown, hourlyTimeline } = snapshot.chartData;

  const peakDay = dailyBars.points.reduce(
    (best, p) => (p.credits > (best?.credits ?? -1) ? p : best),
    dailyBars.points[0] ?? null,
  );
  setSrDesc(
    'chart-daily',
    peakDay
      ? `30-day bar chart. Peak: ${formatCredits(peakDay.credits)} cr on ${peakDay.date}. Today: ${formatCredits(snapshot.today.credits)} cr.`
      : '30-day bar chart. No data.',
  );

  setSrDesc(
    'chart-heatmap',
    heatmap.max > 0
      ? `Activity heatmap, last 12 weeks. Max daily usage: ${formatCredits(heatmap.max)} cr.`
      : 'Activity heatmap. No usage data.',
  );

  const topModel = modelBreakdown.labels[0];
  setSrDesc(
    'chart-models',
    topModel
      ? `Model breakdown. Top model: ${topModel} with ${formatCredits(modelBreakdown.credits[0] ?? 0)} cr.`
      : 'Model breakdown. No data.',
  );

  setSrDesc(
    'chart-category',
    categoryBreakdown.available
      ? `Cost by category: ${categoryBreakdown.categories.map((c, i) => `${c} ${formatMoney(categoryBreakdown.costs[i] ?? 0, snapshot.currency)}`).join(', ')}.`
      : 'Cost category breakdown unavailable.',
  );

  const peak = hourlyTimeline.peakHour;
  setSrDesc(
    'chart-hourly',
    hourlyTimeline.hours.some((h) => h > 0)
      ? `Usage by hour. Peak hour: ${peak}:00.`
      : 'Usage by hour. No data.',
  );
}
