/**
 * Shared, pure data model for Weevil. Imported by BOTH the extension host and
 * the webview bundle, so it must never import `vscode` or any Node/DOM API.
 */

export type Granularity = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

export const GRANULARITIES: readonly Granularity[] = [
  'hour',
  'day',
  'week',
  'month',
  'quarter',
  'year',
];

/** Where a usage event came from. `lm` = accurate (our own @weevil request). */
export type SourceKind = 'lm' | 'local' | 'github' | 'sample';

/** Which Copilot surface produced the event. */
export type Surface = 'chat' | 'inline' | 'agent' | 'edit' | 'unknown';

export type Metric = 'cost' | 'credits' | 'tokens';

/**
 * A single normalized unit of Copilot usage. Costs are plain numbers in the
 * snapshot's currency; `credits` are normalized premium-request weights.
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
  /** git remote slug or folder name — the multi-repo attribution tag. */
  repo?: string;
  workspaceFolder?: string;
  /** set for conversations captured through the @weevil participant. */
  chatId?: string;
}

/** A reusable filter, applied identically by the store, aggregator, UI and notifier. */
export interface Filter {
  range?: { start: number; end: number };
  repos?: string[];
  workspaces?: string[];
  models?: string[];
  surfaces?: Surface[];
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
  byRepo: Record<string, Bucket>;
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

export type ProviderStatusKind = 'ok' | 'degraded' | 'unavailable';

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

export interface Tip {
  id: string;
  title: string;
  body: string;
}

export type StatusBarScope = 'session' | 'today' | 'workspace' | 'repo';

export interface CurrentScopeTotals {
  scope: StatusBarScope;
  label: string;
  credits: number;
  tokens: number;
  cost: number;
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
  topRepos: TopEntry[];
  current: CurrentScopeTotals;
}
