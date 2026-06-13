import { createStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';
import { DatePreset, Filter, Metric, UsageSnapshot } from '../src/model/types';

export interface AppState {
  snapshot: UsageSnapshot | null;
  compact: boolean;
  metric: Metric;
  filter: Filter;
  datePreset: DatePreset;
}

export const store = createStore<AppState>()(
  subscribeWithSelector((): AppState => ({
    snapshot: null,
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
