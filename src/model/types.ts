/**
 * Shared, pure data model for Weevil. Imported by BOTH the extension host and
 * the webview bundle — must never import `vscode` or any Node/DOM API.
 */

export type Granularity = 'day' | 'week' | 'month';

export const GRANULARITIES: readonly Granularity[] = ['day', 'week', 'month'];

/** Where a usage event came from (kept broad for backward-compat with stored events). */
export type SourceKind = 'lm' | 'local' | 'github' | 'sample';

/** Which Copilot surface produced the event. */
export type Surface = 'chat' | 'inline' | 'agent' | 'edit' | 'unknown';

export type Metric = 'cost' | 'credits' | 'tokens';

/** Quick-select date presets for the filter bar. */
export type DatePreset = 'today' | '7d' | '30d' | 'month' | 'all';

/**
 * A single normalized unit of Copilot usage. Costs are plain numbers in USD;
 * `credits` are normalized premium-request weights.
 */
export interface UsageEvent {
  id: string;
  ts: number; // epoch ms
  modelId: string;
  surface: Surface;
  source: SourceKind;
  promptTokens?: number;
  completionTokens?: number;
  credits: number;
  cost: number;
  estimated: boolean;
  /** Kept for backward-compat with stored events; not used in current UI. */
  repo?: string;
}

/** Active filter applied to build the current snapshot. */
export interface Filter {
  range?: { start: number; end: number };
  models?: string[];
  surfaces?: Surface[];
}

export interface Bucket {
  credits: number;
  cost: number;
  tokens: number;
}

export interface UsageAggregate {
  granularity: Granularity;
  bucketKey: string;
  start: number;
  end: number;
  credits: number;
  cost: number;
  tokens: number;
  byModel: Record<string, Bucket>;
  eventCount: number;
  estimated: boolean;
}

export type ForecastBasis = 'linear' | 'seasonal' | 'insufficient-data';

export interface Forecast {
  granularity: 'month';
  projectedCredits: number;
  projectedCost: number;
  low: number;
  high: number;
  basis: ForecastBasis;
  asOf: number;
}

export type PaceStatus = 'no-budget' | 'under' | 'on-track' | 'warning' | 'over';

export interface BudgetState {
  monthly: number | null;
  includedCredits: number;
  usedCredits: number;
  usedCost: number;
  percentOfBudget: number;
  percentOfIncluded: number;
  projectedOverage: number | null;
  pace: PaceStatus;
}

/** `'empty'` = no logs found or no events at all. */
export type ProviderStatusKind = 'ok' | 'degraded' | 'empty';

export interface ProviderStatus {
  kind: ProviderStatusKind;
  reason?: string;
}

export interface TopEntry {
  key: string;
  credits: number;
  cost: number;
  tokens: number;
}

/** One directed edge in the model → surface Sankey chart. */
export interface SankeyLink {
  source: string;
  target: string;
  value: number; // credits
}

/** Today's spend totals — always computed for the status bar. */
export interface TodayTotals {
  credits: number;
  cost: number;
  tokens: number;
}

// ─── Pre-computed chart payloads (assembled on host, consumed by webview) ────

export interface DailyBarPoint {
  date: string;       // MM-DD
  credits: number;
  cost: number;
  colorIndex: number; // 0 = blue (<70%), 1 = amber (70–100%), 2 = red (≥100%)
}

export interface DailyBarsData {
  points: DailyBarPoint[];
  budgetLine: number | null;    // daily included-credits threshold
  projectedLine: number | null; // projected daily pace
}

export interface ModelBreakdownData {
  labels: string[];    // display names, provider-prefix stripped, max 32 chars
  credits: number[];
  costs: number[];
  tokens: number[];
}

export interface HeatmapData {
  cells: ReadonlyArray<{ date: string; value: number }>; // YYYY-MM-DD, credits
  max: number;
}

export interface ChartData {
  dailyBars: DailyBarsData;
  modelBreakdown: ModelBreakdownData;
  heatmap: HeatmapData;
}

/** The single object every piece of UI consumes. */
export interface UsageSnapshot {
  generatedAt: number;
  source: SourceKind;
  status: ProviderStatus;
  currency: string;
  pricePerCredit: number;
  filter: Filter;
  range: { start: number; end: number };
  aggregates: Record<Granularity, UsageAggregate[]>;
  forecast: Forecast;
  budget: BudgetState;
  topModels: TopEntry[];
  today: TodayTotals;
  /** All distinct model IDs in current data (for filter dropdown). */
  allModels: string[];
  /** All distinct surfaces in current data (for surface toggle). */
  allSurfaces: Surface[];
  /** Model → surface flow for the Sankey chart. */
  sankeyLinks: SankeyLink[];
  /** Pre-computed, render-ready data for each chart — assembled on the host. */
  chartData: ChartData;
}
