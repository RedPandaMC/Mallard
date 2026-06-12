/**
 * Typed, validated message envelopes for host <-> webview traffic. Pure (no
 * `vscode`, no DOM) so it can be bundled into both sides. Every inbound message
 * is checked with a type guard before it's acted on.
 */
import { Filter, Granularity, GRANULARITIES, Metric, Tip, UsageSnapshot } from '../model/types';

export type CommandId = 'signIn' | 'setBudget' | 'openDashboard' | 'configureNotifications';

export type WebviewBoundMsg =
  | { type: 'snapshot'; payload: UsageSnapshot; compact: boolean; granularity: Granularity }
  | { type: 'theme' }
  | { type: 'tip'; payload: Tip };

export type HostBoundMsg =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'setGranularity'; value: Granularity }
  | { type: 'setMetric'; value: Metric }
  | { type: 'setFilter'; value: Filter }
  | { type: 'command'; id: CommandId }
  | { type: 'requestTip' };

const METRICS: Metric[] = ['cost', 'credits', 'tokens'];
const COMMAND_IDS: CommandId[] = [
  'signIn',
  'setBudget',
  'openDashboard',
  'configureNotifications',
];

function isObject(m: unknown): m is Record<string, unknown> {
  return typeof m === 'object' && m !== null;
}

export function isHostBoundMsg(m: unknown): m is HostBoundMsg {
  if (!isObject(m) || typeof m.type !== 'string') return false;
  switch (m.type) {
    case 'ready':
    case 'refresh':
    case 'requestTip':
      return true;
    case 'setGranularity':
      return GRANULARITIES.includes(m.value as Granularity);
    case 'setMetric':
      return METRICS.includes(m.value as Metric);
    case 'setFilter':
      return isObject(m.value);
    case 'command':
      return COMMAND_IDS.includes(m.id as CommandId);
    default:
      return false;
  }
}

export function isWebviewBoundMsg(m: unknown): m is WebviewBoundMsg {
  if (!isObject(m) || typeof m.type !== 'string') return false;
  return m.type === 'snapshot' || m.type === 'theme' || m.type === 'tip';
}
