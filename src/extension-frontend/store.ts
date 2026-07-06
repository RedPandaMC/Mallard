import { createStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  DashboardLayout,
  DatePreset,
  DEFAULT_DASHBOARD_LAYOUT,
  DEFAULT_RESTRICTION_STATE,
  DEFAULT_USER_CONFIG,
  Filter,
  Metric,
  RestrictionState,
  UsageSnapshot,
  UserConfig,
} from '../extension-backend/domain/types';

export interface AppState {
  snapshot: UsageSnapshot | null;
  config: UserConfig;
  layout: DashboardLayout;
  metric: Metric;
  filter: Filter;
  datePreset: DatePreset;
  restriction: RestrictionState;
  /**
   * Whether the dashboard is forced into light or dark mode. The toggle
   * itself is strictly binary (light/dark) — `null` is only a transient
   * "not yet initialized" sentinel used once, at startup, to seed the
   * initial value from VS Code's active theme kind.
   */
  forcedScheme: 'light' | 'dark' | null;
  /** Model keys currently spotlighted — other panels dim when this is non-empty. */
  focusedModels: ReadonlySet<string>;
}

export const store = createStore<AppState>()(
  subscribeWithSelector(
    (): AppState => ({
      snapshot: null,
      config: DEFAULT_USER_CONFIG,
      layout: DEFAULT_DASHBOARD_LAYOUT,
      metric: 'cost',
      filter: {},
      datePreset: 'month',
      restriction: DEFAULT_RESTRICTION_STATE,
      forcedScheme: null,
      focusedModels: new Set<string>(),
    }),
  ),
);

/** Read current state synchronously. */
export function state(): AppState {
  return store.getState();
}

/** Merge a partial patch and notify all subscribers. */
export function setState(patch: Partial<AppState>): void {
  store.setState(patch);
}

/** Subscribe to any state change. Returns an unsubscribe function. */
export function subscribe(listener: (s: AppState) => void): () => void {
  return store.subscribe(listener);
}
