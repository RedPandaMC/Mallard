import { Filter, Granularity, Metric, Tip, UsageSnapshot } from '../src/model/types';

export interface AppState {
  snapshot: UsageSnapshot | null;
  granularity: Granularity;
  metric: Metric;
  filter: Filter;
  compact: boolean;
  tip: Tip | null;
}

type Listener = (state: AppState) => void;
const _listeners: Listener[] = [];

export const state: AppState = {
  snapshot: null,
  granularity: 'day',
  metric: 'cost',
  filter: {},
  compact: false,
  tip: null,
};

export function setState(patch: Partial<AppState>): void {
  Object.assign(state, patch);
  for (const l of _listeners) l(state);
}

export function subscribe(listener: Listener): () => void {
  _listeners.push(listener);
  return () => {
    const i = _listeners.indexOf(listener);
    if (i !== -1) _listeners.splice(i, 1);
  };
}
