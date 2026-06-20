/**
 * Shared, pure data model for Mallard. Imported by BOTH the extension host and
 * the webview bundle — must never import `vscode` or any Node/DOM API.
 */

export type Granularity = 'day' | 'week' | 'month';

export const GRANULARITIES: readonly Granularity[] = ['day', 'week', 'month'];

/** Where a usage event came from (kept broad for backward-compat with stored events). */
export type SourceKind = 'lm' | 'local' | 'github';

/** Which Copilot surface produced the event. */
export type Surface = 'chat' | 'inline' | 'agent' | 'edit' | 'unknown';
export const SURFACES = new Set<Surface>(['chat', 'inline', 'agent', 'edit', 'unknown']);
export const SOURCE_KINDS = new Set<SourceKind>(['lm', 'local', 'github']);

export type Metric = 'cost' | 'credits' | 'tokens';

/**
 * Cost-attribution category for a single request. The dimension is optional and
 * partial on each event so it can be added without backfilling old rows.
 *
 * Investigation (June 2026): Copilot's local OTel logs expose only
 * `gen_ai.usage.input_tokens` / `output_tokens` per call (span names `chat`,
 * `invoke_agent`, `execute_tool`); there are no cached-input, reasoning, tool,
 * or cost attributes. So only 'input' and 'output' can be derived locally
 * (split by token ratio). 'tool' and 'thinking' stay reserved for a future
 * source (e.g. GitHub billing SKUs). When nothing is attributable the category
 * chart reports `available: false`.
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
  /** Git branch active at parse time, when resolvable. */
  branch?: string;
  /**
   * Per-category cost split. Optional + partial so the dimension is addable
   * without backfilling old rows; absent → treat the whole event as 'unknown'.
   * When fully attributed, the present entries sum to `cost`.
   */
  costByCategory?: Partial<Record<CostCategory, number>>;
}

/**
 * User-editable config that lives in extension globalState (NOT settings.json)
 * and is edited from the webview. Shared so both host and webview are typed.
 */
export interface AlertConfig {
  /** Warn when the recent spending rate exceeds the credits/hour threshold. */
  velocityEnabled: boolean;
  velocityCreditsPerHour: number;
}

export type RestrictionMode = 'soft' | 'hard';

export type RestrictionScope = 'copilot' | 'copilot+lab' | 'custom';

// ── JSON condition types ─────────────────────────────────────────────────────

/** A value that can appear on either side of a comparison operator. */
export type JsonOperand = number | string | boolean | { var: string };

/**
 * A JSONLogic-inspired condition tree. Evaluated by `evalCondition()`.
 *
 * Examples:
 *   `true` — always fires
 *   `{ ">": [{ "var": "today.credits" }, 50] }` — fires when today > 50 cr
 *   `{ "and": [ ... ] }` — all sub-conditions must be true
 *   `{ "var": "group.g1" }` — truthy check (used for group gates)
 */
export type JsonCondition =
  | boolean
  | { '>':  [JsonOperand, JsonOperand] }
  | { '>=': [JsonOperand, JsonOperand] }
  | { '<':  [JsonOperand, JsonOperand] }
  | { '<=': [JsonOperand, JsonOperand] }
  | { '==': [JsonOperand, JsonOperand] }
  | { '!=': [JsonOperand, JsonOperand] }
  | { 'and': JsonCondition[] }
  | { 'or':  JsonCondition[] }
  | { 'not': JsonCondition }
  | { 'var': string };

export interface RuleRestrict {
  mode: RestrictionMode;
  scope: RestrictionScope;
  reEnableWhen?: JsonCondition;
  graceMinutes?: number;
}

export interface AlertRule {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  cooldown?: string;
  message: string;
  when: JsonCondition;
  active?: JsonCondition;
  requiresAuth?: boolean;
  notify?: boolean;
  restrict?: RuleRestrict;
}

export interface AlertGroup {
  id: string;
  label?: string;
  active: JsonCondition;
}

export interface UserConfig {
  /** Monthly USD budget; 0 = no budget set. */
  monthlyBudget: number;
  /** Premium requests included in the plan; colours the spend gauge. */
  includedCredits: number;
  /** Warn once a day when daily credits exceed this; 0 = off. */
  dailyCreditAlert: number;
  alerts: AlertConfig;
  /** Optional v2 fields (added in §4 of the design). */
  version?: 1 | 2;
  vars?: Record<string, number | string | boolean | (string | number)[]>;
  groups?: AlertGroup[];
  rules?: AlertRule[];
  budget?: { monthlyUsd: number; includedCredits: number };
  /** Per-branch credit caps keyed by branch name. Used in restriction rules. */
  branchBudgets?: Record<string, number>;
}

export const DEFAULT_USER_CONFIG: UserConfig = {
  monthlyBudget: 0,
  includedCredits: 300,
  dailyCreditAlert: 0,
  alerts: { velocityEnabled: false, velocityCreditsPerHour: 0 },
  version: 1,
  vars: {},
  groups: [],
  rules: [],
  budget: { monthlyUsd: 0, includedCredits: 300 },
};

export interface RestrictionState {
  version: 1;
  active: boolean;
  scope: string;
  ruleId: string;
  reasonMessage: string;
  firedAt: number;
  graceExpiresAt: number | null;
  userOverrideUntil: number | null;
}

export const DEFAULT_RESTRICTION_STATE: RestrictionState = {
  version: 1,
  active: false,
  scope: '',
  ruleId: '',
  reasonMessage: '',
  firedAt: 0,
  graceExpiresAt: null,
  userOverrideUntil: null,
};

/**
 * Chart colour palette mode (the `mallard.palette` setting):
 * - `swiss`: the fixed Swiss duotone — one red accent + a grayscale ramp.
 * - `theme`: derive the accent from the active VS Code theme, validated for
 *   contrast and colour-blindness, keeping the duotone structure.
 * Both modes are run through the accessibility checks in webview/color.ts.
 */
export type PaletteMode = 'swiss' | 'theme';

/**
 * Persisted dashboard layout. Each analysis panel has a position (array order),
 * a width span (1 = half, 2 = full, in the two-column grid), and a visibility
 * flag. Edited in the dashboard's edit mode and stored in globalState.
 */
export interface DashboardPanelLayout {
  id: string;
  span: 1 | 2;
  hidden: boolean;
}

export type DashboardLayout = DashboardPanelLayout[];

/** The analysis panels that can be reordered, resized, and hidden. */
export const DASHBOARD_PANELS = [
  'daily',
  'heatmap',
  'models',
  'sankey',
  'category',
  'cumulative',
  'weekday',
  'hourly',
] as const;

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = [
  { id: 'daily', span: 2, hidden: false },
  { id: 'heatmap', span: 2, hidden: false },
  { id: 'models', span: 1, hidden: false },
  { id: 'sankey', span: 1, hidden: false },
  { id: 'category', span: 1, hidden: false },
  { id: 'cumulative', span: 1, hidden: false },
  { id: 'weekday', span: 1, hidden: false },
  { id: 'hourly', span: 1, hidden: false },
];

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
  date: string; // MM-DD
  credits: number;
  cost: number;
  colorIndex: number; // 0 = blue (<70%), 1 = amber (70–100%), 2 = red (≥100%)
}

export interface DailyBarsData {
  points: DailyBarPoint[];
  budgetLine: number | null; // daily included-credits threshold
  projectedLine: number | null; // projected daily pace
}

export interface ModelBreakdownData {
  labels: string[]; // display names, provider-prefix stripped, max 32 chars
  credits: number[];
  costs: number[];
  tokens: number[];
  /** Cost if each request had used the cheapest available model (same token count). */
  cheapestEquivalentCosts: number[];
}

/** Credits bucketed by hour-of-day (0–23), summed across the filter window. */
export interface HourlyTimelineData {
  hours: number[];
  peakHour: number;
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
  hourlyTimeline: HourlyTimelineData;
}

/** The single object every piece of UI consumes. */
export interface UsageSnapshot {
  generatedAt: number;
  source: SourceKind;
  /** True when only the current day's bar changed since the previous snapshot. */
  isIncremental: boolean;
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
  /** Currently active git branch, when detectable. */
  currentBranch?: string;
  /** Total credits attributed to the current branch in the visible window. */
  currentBranchCredits: number;
}
