import { createStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  DashboardLayout,
  DatePreset,
  DEFAULT_DASHBOARD_LAYOUT,
  DEFAULT_USER_CONFIG,
  Filter,
  Metric,
  UsageSnapshot,
  UserConfig,
} from '../src/domain/types';

export interface AppState {
  snapshot: UsageSnapshot | null;
  config: UserConfig;
  layout: DashboardLayout;
  compact: boolean;
  metric: Metric;
  filter: Filter;
  datePreset: DatePreset;
}

export const store = createStore<AppState>()(
  subscribeWithSelector((): AppState => ({
    snapshot: null,
    config: DEFAULT_USER_CONFIG,
    layout: DEFAULT_DASHBOARD_LAYOUT,
    compact: false,
    metric: 'cost',
    filter: {},
    datePreset: 'month',
  })),
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
