/* c8 ignore next */
/**
 * Shared, pure data model for Mallard. Imported by BOTH the extension host and
 * the webview bundle — must never import `vscode` or any Node/DOM API.
 */

export type Granularity = 'day' | 'week' | 'month';

export const GRANULARITIES: readonly Granularity[] = ['day', 'week', 'month'];

/** Where a usage event came from (kept broad for backward-compat with stored events). */
export type SourceKind = 'lm' | 'local' | 'github' | 'claude-code';

/** Snapshot-level provenance summary: a single event source, or 'mixed' when the
 *  snapshot aggregates more than one. Distinct from the per-event SourceKind so
 *  'mixed' never leaks into the event source filter. */
export type SnapshotSource = SourceKind | 'mixed';

/** Which Copilot surface produced the event. */
export type Surface = 'chat' | 'inline' | 'agent' | 'edit' | 'unknown';
export const SURFACES = new Set<Surface>(['chat', 'inline', 'agent', 'edit', 'unknown']);
export const SOURCE_KINDS = new Set<SourceKind>(['lm', 'local', 'github', 'claude-code']);

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
export type CostCategory = 'input' | 'output' | 'tool' | 'thinking' | 'cache_creation' | 'cache_read' | 'unknown';

export const COST_CATEGORIES: readonly CostCategory[] = [
  'input',
  'output',
  'tool',
  'thinking',
  'cache_creation',
  'cache_read',
  'unknown',
];

/** Quick-select date presets for the filter bar. */
export type DatePreset = 'today' | '7d' | '30d' | 'month' | 'all';

/**
 * A single normalized unit of Copilot usage. Costs are plain numbers in USD;
 * `credits` are normalized premium-request weights.
 */
/** Provenance of an event's repo/branch attribution. */
export type RepoAttribution = 'authoritative' | 'heuristic';

export interface UsageEvent {
  id: string;
  ts: number; // epoch ms
  modelId: string;
  surface: Surface;
  source: SourceKind;
  promptTokens?: number;
  completionTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  thinkingTokens?: number;
  credits: number;
  cost: number;
  estimated: boolean;
  /** Workspace repo this usage is attributed to, when resolvable. */
  repo?: string;
  /** Git branch active at parse time, when resolvable. */
  branch?: string;
  /**
   * How `repo` was determined: 'authoritative' when the source log records it
   * (Claude Code's per-line cwd), 'heuristic' when it's the active-editor
   * guess at parse time. Absent when the event is unattributed.
   */
  attribution?: RepoAttribution;
  /**
   * Programming language this usage is attributed to (VS Code languageId).
   * Heuristic like the repo fallback — the active editor's language at parse
   * time, applied to live rows only — unless the source log names one.
   */
  language?: string;
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
  reEnableWhen?: JsonCondition;
}

/**
 * A single condition in the structured `conditions` shorthand.
 * More approachable than raw JSONLogic — no nested prefix notation required.
 *
 * Supported operators: `>` `>=` `<` `<=` `==` `!=` `in` `matches`
 */
export interface SimpleCondition {
  /** Dot-path into the rule context. E.g. "today.credits", "budget.percentOfBudget". */
  field: string;
  /** Comparison operator. */
  op: '>' | '>=' | '<' | '<=' | '==' | '!=' | 'in' | 'matches';
  /** Value to compare against. For `in`, provide an array. */
  value: number | string | boolean | (string | number)[];
}

/**
 * A single severity level in a threshold escalation rule.
 * The highest-severity threshold whose condition fires wins.
 */
export interface ThresholdLevel extends SimpleCondition {
  severity: 'info' | 'warning' | 'critical';
  /** Per-level cooldown (overrides the rule-level cooldown for this severity). */
  cooldown?: string;
}

export interface AlertRule {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  cooldown?: string;
  message: string;
  /**
   * JSONLogic condition tree (original syntax). Required unless `conditions` is provided.
   */
  when?: JsonCondition;
  /**
   * Structured conditions shorthand. Easier to read and write than JSONLogic.
   * Use `match` to control how conditions are combined.
   */
  conditions?: SimpleCondition[];
  /**
   * How to combine `conditions`. Defaults to "all" (AND).
   * Ignored when `when` is used.
   */
  match?: 'all' | 'any' | 'none';
  active?: JsonCondition;
  requiresAuth?: boolean;
  notify?: boolean;
  restrict?: RuleRestrict;
  /**
   * Severity escalation: instead of a single `when`, declare multiple threshold
   * levels. The highest-severity level whose condition fires wins. Each level
   * can have its own cooldown.
   */
  thresholds?: ThresholdLevel[];
  /**
   * Snooze this rule until an ISO 8601 timestamp. The rule is suppressed while
   * the current time is before `snoozeUntil`. Typically set via the UI.
   */
  snoozeUntil?: string;
}

export interface AlertGroup {
  id: string;
  label?: string;
  active: JsonCondition;
}

export interface DisplayPrefs {
  /** Days shown in the daily-bars and cumulative-area charts. Default 30. */
  dailyBarsWindow?: number;
  /** Weeks shown in the activity heatmap. Default 12. */
  heatmapWeeks?: number;
  /** Max models/repos shown in ranked lists. Default 8. */
  topN?: number;
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
  /** Config-driven dashboard layout (CSS grid syntax). Overrides globalState order/sizing. */
  dashboard?: ConfigDashboard;
  /** GitHub billing auth configuration (PAT or VS Code session). */
  githubBilling?: GitHubBillingConfig;
  /** Dashboard display preferences (chart windows, top-N). */
  display?: DisplayPrefs;
  /** Display currency (ISO code, e.g. "EUR"). Dashboard-editable, so it lives
   *  here in UserConfigStore rather than VS Code settings. */
  currency?: string;
  /** Metric export extras beyond the mallard.* settings. */
  export?: ExportConfig;
}

/** Metric export configuration block in config.json. */
export interface ExportConfig {
  /**
   * Additional webhook servers to mirror every metric payload to, on top of
   * the primary mallard.server.url target. Active when the transport is
   * "webhook".
   */
  webhookTargets?: ExportTarget[];
  /**
   * Additional MQTT brokers to mirror every metric payload to, on top of the
   * primary mallard.mqtt.url / mallard.server.url broker. Active when the
   * transport is "mqtt".
   */
  mqttTargets?: ExportTarget[];
}

/** One extra export destination (webhook server or MQTT broker). */
export interface ExportTarget {
  /**
   * Unique name for this target (e.g. "team"). Also namespaces the target's
   * credentials in SecretStorage — set them via "Mallard: Manage Credentials".
   */
  name: string;
  /**
   * Endpoint URL: https:// base URL for webhook targets, wss:// URL for MQTT
   * targets — same semantics as mallard.server.url / mallard.mqtt.url.
   */
  url: string;
}

/**
 * GitHub billing authentication and scope configuration.
 * All fields are machine-scoped and never synced.
 */
export interface GitHubBillingConfig {
  /**
   * Auth mode:
   *  - `"vscode-session"` (default): use VS Code's built-in GitHub OAuth session.
   *  - `"pat"`: use the personal access token stored via
   *    "Mallard: Set GitHub Personal Access Token" (SecretStorage) and never
   *    fall through to an OAuth prompt.
   */
  mode?: 'vscode-session' | 'pat';
  /**
   * GitHub organization slug. When set, fetches org-level billing instead of
   * the individual user's billing. Requires `read:org` scope on the token or
   * session.
   */
  org?: string;
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

/** Opinionated first-install config. Only written when config.json does not yet exist. */
export const SEED_USER_CONFIG: Partial<UserConfig> = {
  dailyCreditAlert: 50,
  alerts: { velocityEnabled: true, velocityCreditsPerHour: 100 },
};

export interface RestrictionState {
  version: 1;
  active: boolean;
  ruleId: string;
  reasonMessage: string;
  firedAt: number;
  userOverrideUntil: number | null;
}

export const DEFAULT_RESTRICTION_STATE: RestrictionState = {
  version: 1,
  active: false,
  ruleId: '',
  reasonMessage: '',
  firedAt: 0,
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
 * a width span (number of grid columns it occupies, 1..MAX_PANEL_SPAN, clamped
 * at render time to the configured column count), and a visibility flag. Edited
 * in the dashboard's edit mode and stored in globalState.
 */
export type PanelSize = 'compact' | 'normal' | 'tall';

/** Widest a panel may span — matches the maximum configurable column count. */
export const MAX_PANEL_SPAN = 4;

export interface DashboardPanelLayout {
  id: string;
  span: number;
  hidden: boolean;
  size?: PanelSize;
}

export type DashboardLayout = DashboardPanelLayout[];

/**
 * Dashboard panel entry from config.json, using CSS grid shorthand syntax so
 * the values map directly to the `grid-column` and `grid-row` CSS properties.
 * Example: `{ "id": "daily", "gridColumn": "span 2", "gridRow": "span 1" }`
 */
export interface ConfigPanelLayout {
  id: string;
  /** CSS grid-column shorthand. E.g. "span 1" or "span 2". */
  gridColumn?: string;
  /** CSS grid-row shorthand. E.g. "span 1" or "span 2". Optional. */
  gridRow?: string;
  hidden?: boolean;
  size?: PanelSize;
}

/** Dashboard block in config.json — sets column count and panel order/sizing. */
export interface ConfigDashboard {
  /** Number of columns in the grid (1–4). Default: 2. */
  columns?: number;
  /** Panel declarations. Unlisted panels fall back to globalState defaults. */
  panels?: ConfigPanelLayout[];
}

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
  'repos',
  'categoryTrend',
  'tokens',
  'billing',
  'languages',
] as const;

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = [
  { id: 'daily', span: 2, hidden: false, size: 'normal' },
  { id: 'heatmap', span: 2, hidden: false, size: 'normal' },
  { id: 'models', span: 1, hidden: false, size: 'normal' },
  { id: 'sankey', span: 1, hidden: false, size: 'normal' },
  { id: 'category', span: 1, hidden: false, size: 'normal' },
  { id: 'cumulative', span: 1, hidden: false, size: 'normal' },
  { id: 'weekday', span: 1, hidden: false, size: 'normal' },
  { id: 'hourly', span: 1, hidden: false, size: 'normal' },
  // Extra charts: part of the panel set but hidden until added via the
  // dashboard's "Add chart" picker.
  { id: 'repos', span: 1, hidden: true, size: 'normal' },
  { id: 'categoryTrend', span: 2, hidden: true, size: 'normal' },
  { id: 'tokens', span: 1, hidden: true, size: 'normal' },
  { id: 'billing', span: 1, hidden: true, size: 'normal' },
  { id: 'languages', span: 1, hidden: true, size: 'normal' },
/* c8 ignore next */
];

/** Active filter applied to build the current snapshot. */
export interface Filter {
  range?: { start: number; end: number };
  models?: string[];
  surfaces?: Surface[];
  repos?: string[];
  /** Filter to specific git branches. */
  branches?: string[];
  /** Filter to specific sources (e.g. 'local', 'claude-code'). */
  sources?: SourceKind[];
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

/** `'empty'` = no logs found or no events at all. `'loading'` = initial parse in progress. */
export type ProviderStatusKind = 'ok' | 'degraded' | 'empty' | 'loading';

export interface ProviderStatus {
  kind: ProviderStatusKind;
  reason?: string;
}

export interface TopEntry {
  key: string;
  credits: number;
  cost: number;
  tokens: number;
  /**
   * Fraction of this entry's cost attributed by the active-editor heuristic
   * rather than recorded in the source log (0..1). Only set on per-repo
   * entries; lets the UI badge approximate attributions with "\u2248".
   */
  heuristicShare?: number;
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
  /** Running cost total per day: `cumulativeCosts[i]` = sum of cost for days 0..i. */
  cumulativeCosts: number[];
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
  /** Most active hour, or null when there is no hourly activity at all. */
  peakHour: number | null;
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

/** Daily token/event volume for the tokens-over-time chart. */
export interface TokensDailyData {
  /** MM-DD labels, oldest first (same window as dailyBars). */
  dates: string[];
  tokens: number[];
  events: number[];
}

/** Per-day cost split by category, for the stacked category-trend chart. */
export interface CategoryTrendData {
  /** MM-DD labels, oldest first (same window as dailyBars). */
  dates: string[];
  /** One entry per category that has any nonzero cost in the window. */
  series: Array<{ category: CostCategory; costs: number[] }>;
  /** false hides the chart (no per-category data at all). */
  available: boolean;
}

/** Credits and event count indexed by weekday (0=Sun … 6=Sat). */
export interface WeekdayData {
  /** Credits per weekday, index 0=Sun … 6=Sat. */
  totals: number[];
  /** Index of the busiest weekday (0–6, Sun=0 basis). */
  peak: number;
}

export interface ChartData {
  dailyBars: DailyBarsData;
  modelBreakdown: ModelBreakdownData;
  heatmap: HeatmapData;
  categoryBreakdown: CategoryBreakdownData;
  hourlyTimeline: HourlyTimelineData;
  weekdayBreakdown: WeekdayData;
  tokensDaily: TokensDailyData;
  categoryTrend: CategoryTrendData;
}

/**
 * The snapshot is split into three facets so consumers can depend on only
 * what they read: scalar summary (core), dimension breakdowns (dims), and
 * GitHub billing/auth (billing — which updates on its own cadence, without a
 * database recompute). The wire type the webview receives (UsageSnapshot) is
 * still the flat intersection of all three plus render-ready chart data.
 */
export interface SnapshotCore {
  generatedAt: number;
  source: SnapshotSource;
  status: ProviderStatus;
  currency: string;
  pricePerCredit: number;
  /** USD-based exchange rates from Frankfurter (USD = 1.0, others relative). */
  fxRates: Record<string, number>;
  filter: Filter;
  range: { start: number; end: number };
  forecast: Forecast;
  budget: BudgetState;
  today: TodayTotals;
  /** Currently active git branch, when detectable. */
  currentBranch?: string;
  /** Total credits attributed to the current branch in the visible window. */
  currentBranchCredits: number;
  /** Events in the snapshot window (drives export counters). */
  totalEventCount?: number;
  /** Events whose cost is estimated (log-derived) rather than authoritative. */
  estimatedEventCount?: number;
}

/** Dimension breakdowns: per-model/repo/surface aggregates and filter options. */
export interface SnapshotDims {
  topModels: TopEntry[];
  /** All distinct model IDs in current data (for filter dropdown). */
  allModels: string[];
  /** All distinct surfaces in current data (for surface toggle). */
  allSurfaces: Surface[];
  /** All distinct source kinds in current data (for source filter). */
  allSources: SourceKind[];
  /** Model → surface flow for the Sankey chart. */
  sankeyLinks: SankeyLink[];
  /** All distinct repos in current data (for the repo filter). */
  allRepos: string[];
  /** Per-repo spend, for workspace-aware attribution. */
  byRepo: TopEntry[];
  /**
   * Per-language spend. Detected like the repo heuristic — the active
   * editor's languageId at parse time, live rows only — unless the source
   * log names a language. Rows without one aggregate under 'unknown'.
   */
  byLanguage: TopEntry[];
}

/** GitHub auth + billing state; refreshed independently of usage data. */
export interface BillingState {
  authStatus: AuthStatus;
  /** Human-readable detail when authStatus is 'error' (e.g. a PAT is required). */
  authError?: string;
  /** Authoritative billing data from the GitHub API, when signed in. */
  githubBilling?: GitHubBillingData;
}

/**
 * Everything buildChartData needs beyond core/dims — carried on the host-side
 * SnapshotData so chart assembly can run lazily at the UI boundary instead of
 * inside every recompute.
 */
export interface ChartInputs {
  dayAggregates: UsageAggregate[];
  categoryBreakdown: CategoryBreakdownData;
  hourlyTimeline: HourlyTimelineData;
  /** Credits per weekday, index 0=Sun … 6=Sat. */
  weekday: number[];
  /** Per-day cost split by category (display currency), oldest first. */
  categoryDaily: CategoryDailyRow[];
}

/** One day's per-category cost split (input for CategoryTrendData). */
export interface CategoryDailyRow {
  dayStart: number;
  costs: Partial<Record<CostCategory, number>>;
}

/** Host-internal snapshot: all facets plus raw chart inputs, no render data. */
export interface SnapshotData extends SnapshotCore, SnapshotDims, BillingState {
  chartInputs: ChartInputs;
}

/** The single object the webview consumes (wire shape). */
export interface UsageSnapshot extends SnapshotCore, SnapshotDims, BillingState {
  /** True when only the current day's bar changed since the previous snapshot. */
  isIncremental: boolean;
  /** Pre-computed, render-ready data for each chart — assembled on the host. */
  chartData: ChartData;
}
