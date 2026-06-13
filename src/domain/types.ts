/**
 * Shared, pure data model for Weevil. Imported by BOTH the extension host and
 * the webview bundle — must never import `vscode` or any Node/DOM API.
 */

export type Granularity = 'day' | 'week' | 'month';

export const GRANULARITIES: readonly Granularity[] = ['day', 'week', 'month'];

/** Where a usage event came from (kept broad for backward-compat with stored events). */
export type SourceKind = 'lm' | 'local' | 'github';

/** Which Copilot surface produced the event. */
export type Surface = 'chat' | 'inline' | 'agent' | 'edit' | 'unknown';

export type Metric = 'cost' | 'credits' | 'tokens';

/**
 * Cost-attribution category for a single request. The dimension is optional and
 * partial on each event so it can be added without backfilling old rows.
 *
 * NOTE (investigation pending): Copilot's local OTel logs currently expose only
 * aggregate input/output token counts; 'tool' and 'thinking' are only populated
 * if the logs (or the GitHub billing SKUs) are found to carry that granularity.
 * When no breakdown is available the category chart reports `available: false`.
 */
export type CostCategory = 'input' | 'output' | 'tool' | 'thinking' | 'unknown';

export const COST_CATEGORIES: readonly CostCategory[] = [
  'input',
  'output',
  'tool',
  'thinking',
  'unknown',
];

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
  /** Workspace repo this usage is attributed to, when resolvable. */
  repo?: string;
  /**
   * Per-category cost split. Optional + partial so the dimension is addable
   * without backfilling old rows; absent → treat the whole event as 'unknown'.
   * When fully attributed, the present entries sum to `cost`.
   */
  costByCategory?: Partial<Record<CostCategory, number>>;
}

/** Active filter applied to build the current snapshot. */
export interface Filter {
  range?: { start: number; end: number };
  models?: string[];
  surfaces?: Surface[];
  repos?: string[];
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

// ─── GitHub billing ──────────────────────────────────────────────────────────

export type AuthStatus = 'loading' | 'signed-in' | 'signed-out' | 'error';

export interface GitHubBillingItem {
  model: string;
  sku: string;
  grossAmount: number;
  netAmount: number;
  grossQuantity: number;
}

export interface GitHubQuota {
  plan: string;
  entitlement: number;
  used: number;
  resetDate: number | null;
  unlimited: boolean;
}

export interface GitHubBillingData {
  quota: GitHubQuota | null;
  items: GitHubBillingItem[];
  fetchedAt: number;
  totalNetAmount: number;
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

/** Spend split by cost category. `available: false` hides the chart entirely. */
export interface CategoryBreakdownData {
  categories: CostCategory[];
  costs: number[];
  available: boolean;
}

export interface ChartData {
  dailyBars: DailyBarsData;
  modelBreakdown: ModelBreakdownData;
  heatmap: HeatmapData;
  categoryBreakdown: CategoryBreakdownData;
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
  /** All distinct repos in current data (for the repo filter). */
  allRepos: string[];
  /** Per-repo spend, for workspace-aware attribution. */
  byRepo: TopEntry[];
  /** Pre-computed, render-ready data for each chart — assembled on the host. */
  chartData: ChartData;
  /** GitHub auth state for the billing integration panel. */
  authStatus: AuthStatus;
  /** Authoritative billing data from the GitHub API, when signed in. */
  githubBilling?: GitHubBillingData;
}
