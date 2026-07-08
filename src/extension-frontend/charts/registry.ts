/**
 * The single registration point for dashboard charts. Adding a chart is one
 * entry here (plus its module): panel HTML, lazy mounting, layout defaults,
 * resize/theme fan-out, and the dirty-check render loop in main.ts all
 * iterate this list instead of hardcoding each chart.
 */
import type { Metric, UsageSnapshot } from '../../extension-backend/domain/types';
import {
  changed,
  dailyBarsChanged,
  categoryBreakdownChanged,
  heatmapChanged,
  hourlyChanged,
  modelBreakdownChanged,
} from '../chartDiff';
import { mountDailyBars } from './dailyBars';
import { mountCumulativeArea } from './cumulativeArea';
import { mountModelBreakdown } from './modelBreakdown';
import { mountSankey } from './sankey';
import { mountCategoryBreakdown } from './categoryBreakdown';
import { mountHeatmap } from './heatmap';
import { mountHourlyTimeline } from './hourlyTimeline';
import { mountWeekdayRadial } from './weekdayRadial';
import { mountRepoBreakdown } from './repoBreakdown';
import { mountCategoryTrend } from './categoryTrend';
import { mountTokensTimeline } from './tokensTimeline';
import { mountBillingItems } from './billingItems';

/** Per-render context beyond the snapshot itself. */
export interface RenderCtx {
  metric: Metric;
  focusedModels: string[];
}

/** Host-side callbacks a chart can invoke (e.g. bar click → filter toggle). */
export interface ChartHooks {
  toggleModelFilter(label: string): void;
}

/** Uniform handle every registry entry's mount() returns. */
export interface RegisteredChart {
  update(s: UsageSnapshot, ctx: RenderCtx): void;
  resize(): void;
  reinit(): void;
}

export interface ChartDef {
  /** Panel id — must appear in DASHBOARD_PANELS/DEFAULT_DASHBOARD_LAYOUT. */
  id: string;
  /** Stock charts render by default; extras start hidden until added. */
  tier: 'stock' | 'extra';
  icon: string;
  title: string;
  bodyId: string;
  ariaLabel: string;
  bodyClass?: string;
  mount(el: HTMLElement, hooks: ChartHooks): RegisteredChart;
  /** Slice of the snapshot this chart renders from (drives the dirty check). */
  select(s: UsageSnapshot): unknown;
  /** Comparator over two select() results; true = re-render. */
  isDirty(prev: unknown, next: unknown): boolean;
  /** When true the panel gets the wv-no-data treatment. */
  noData?(s: UsageSnapshot): boolean;
  /** Re-render when the metric toggle changes (models chart). */
  usesMetric?: boolean;
  /** Re-render when the model-focus set changes (models chart). */
  usesFocus?: boolean;
}

/** Adapt a plain `update(snapshot)` handle to the RegisteredChart shape. */
function plain(h: { update(s: UsageSnapshot): void; resize(): void; reinit(): void }): RegisteredChart {
  return { update: (s) => h.update(s), resize: () => h.resize(), reinit: () => h.reinit() };
}

export const CHART_REGISTRY: readonly ChartDef[] = [
  {
    id: 'daily', tier: 'stock', icon: 'codicon-graph',
    title: 'Daily usage (last 30 days)', bodyId: 'chart-daily', ariaLabel: 'Daily usage bar chart',
    mount: (el) => plain(mountDailyBars(el)),
    select: (s) => s.chartData.dailyBars,
    isDirty: (a, b) => dailyBarsChanged(a as never, b as never),
  },
  {
    id: 'heatmap', tier: 'stock', icon: 'codicon-calendar',
    title: 'Activity (past year)', bodyId: 'chart-heatmap', ariaLabel: 'Activity heatmap', bodyClass: 'heatmap',
    mount: (el) => plain(mountHeatmap(el)),
    select: (s) => s.chartData.heatmap,
    isDirty: (a, b) => heatmapChanged(a as never, b as never),
    noData: (s) => s.chartData.heatmap.max <= 0,
  },
  {
    id: 'models', tier: 'stock', icon: 'codicon-symbol-method',
    title: 'By model', bodyId: 'chart-models', ariaLabel: 'Usage by model', bodyClass: 'mini',
    mount: (el, hooks) => {
      const h = mountModelBreakdown(el, (label) => hooks.toggleModelFilter(label));
      return {
        update: (s, ctx) => { h.setFocused(new Set(ctx.focusedModels)); h.update(s, ctx.metric); },
        resize: () => h.resize(),
        reinit: () => h.reinit(),
      };
    },
    select: (s) => s.chartData.modelBreakdown,
    isDirty: (a, b) => modelBreakdownChanged(a as never, b as never),
    usesMetric: true,
    usesFocus: true,
  },
  {
    id: 'sankey', tier: 'stock', icon: 'codicon-type-hierarchy-sub',
    title: 'Flow breakdown', bodyId: 'chart-sankey', ariaLabel: 'Model to surface flow', bodyClass: 'mini',
    mount: (el) => plain(mountSankey(el)),
    select: (s) => [s.sankeyLinks, s.allModels, s.allSurfaces],
    isDirty: changed,
    noData: (s) => s.sankeyLinks.length === 0,
  },
  {
    id: 'category', tier: 'stock', icon: 'codicon-pie-chart',
    title: 'Spend by cost type', bodyId: 'chart-category', ariaLabel: 'Spend by cost type', bodyClass: 'mini',
    mount: (el) => plain(mountCategoryBreakdown(el)),
    select: (s) => s.chartData.categoryBreakdown,
    isDirty: (a, b) => categoryBreakdownChanged(a as never, b as never),
    noData: (s) => !s.chartData.categoryBreakdown.available,
  },
  {
    id: 'cumulative', tier: 'stock', icon: 'codicon-graph-line',
    title: 'Cumulative spend', bodyId: 'chart-cumulative', ariaLabel: 'Cumulative spend over the month', bodyClass: 'mini',
    mount: (el) => plain(mountCumulativeArea(el)),
    select: (s) => s.chartData.dailyBars,
    isDirty: (a, b) => dailyBarsChanged(a as never, b as never),
  },
  {
    id: 'weekday', tier: 'stock', icon: 'codicon-pulse',
    title: 'Usage by weekday', bodyId: 'chart-weekday', ariaLabel: 'Usage by weekday', bodyClass: 'mini',
    mount: (el) => plain(mountWeekdayRadial(el)),
    select: (s) => s.chartData.weekdayBreakdown,
    isDirty: changed,
    noData: (s) => s.chartData.weekdayBreakdown.totals.every((v) => v === 0),
  },
  {
    id: 'hourly', tier: 'stock', icon: 'codicon-clock',
    title: 'Usage by hour', bodyId: 'chart-hourly', ariaLabel: 'Usage by hour of day', bodyClass: 'mini',
    mount: (el) => plain(mountHourlyTimeline(el)),
    select: (s) => s.chartData.hourlyTimeline,
    isDirty: (a, b) => hourlyChanged(a as never, b as never),
  },
  // ── Extra charts (hidden by default; added via the "Add chart" picker) ──
  {
    id: 'repos', tier: 'extra', icon: 'codicon-repo',
    title: 'By repository', bodyId: 'chart-repos', ariaLabel: 'Spend by repository', bodyClass: 'mini',
    mount: (el) => plain(mountRepoBreakdown(el)),
    select: (s) => s.byRepo,
    isDirty: changed,
    noData: (s) => !s.byRepo.some((r) => r.credits > 0 || r.cost > 0),
  },
  {
    id: 'categoryTrend', tier: 'extra', icon: 'codicon-layers',
    title: 'Cost categories over time', bodyId: 'chart-category-trend', ariaLabel: 'Cost categories over time',
    mount: (el) => plain(mountCategoryTrend(el)),
    select: (s) => s.chartData.categoryTrend,
    isDirty: changed,
    noData: (s) => !s.chartData.categoryTrend.available,
  },
  {
    id: 'tokens', tier: 'extra', icon: 'codicon-symbol-numeric',
    title: 'Tokens over time', bodyId: 'chart-tokens', ariaLabel: 'Token volume over time', bodyClass: 'mini',
    mount: (el) => plain(mountTokensTimeline(el)),
    select: (s) => s.chartData.tokensDaily,
    isDirty: changed,
    noData: (s) => !s.chartData.tokensDaily.tokens.some((v) => v > 0),
  },
  {
    id: 'billing', tier: 'extra', icon: 'codicon-credit-card',
    title: 'GitHub billing items', bodyId: 'chart-billing', ariaLabel: 'GitHub billing line items', bodyClass: 'mini',
    mount: (el) => plain(mountBillingItems(el)),
    select: (s) => s.githubBilling?.items ?? [],
    isDirty: changed,
    noData: (s) => !(s.githubBilling?.items ?? []).some((it) => it.netAmount > 0 || it.grossAmount > 0),
  },
];
