import { DatePreset, Filter, Metric, UsageSnapshot } from '../src/model/types';

export interface AppState {
  snapshot: UsageSnapshot | null;
  compact: boolean;
  metric: Metric;
  filter: Filter;
  datePreset: DatePreset;
}

type Listener = (state: AppState) => void;
const _listeners: Listener[] = [];

export const state: AppState = {
  snapshot: null,
  compact: false,
  metric: 'cost',
  filter: {},
  datePreset: 'month',
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
