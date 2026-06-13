/**
 * Typed, validated message envelopes for host <-> webview traffic.
 * Pure — no `vscode`, no DOM — so it can be bundled into both sides.
 */
import { DashboardLayout, Filter, UsageSnapshot, UserConfig } from '../domain/types';

export type CommandId = 'openDashboard' | 'signIn';

export type WebviewBoundMsg =
  | { type: 'snapshot'; payload: UsageSnapshot; compact: boolean }
  | { type: 'config'; value: UserConfig }
  | { type: 'layout'; value: DashboardLayout }
  | { type: 'theme' };

export type HostBoundMsg =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'setFilter'; value: Filter }
  | { type: 'setConfig'; value: Partial<UserConfig> }
  | { type: 'setLayout'; value: DashboardLayout }
  | { type: 'command'; id: CommandId };

const COMMAND_IDS: CommandId[] = ['openDashboard', 'signIn'];

function isObject(m: unknown): m is Record<string, unknown> {
  return typeof m === 'object' && m !== null;
}

export function isHostBoundMsg(m: unknown): m is HostBoundMsg {
  if (!isObject(m) || typeof m.type !== 'string') return false;
  switch (m.type) {
    case 'ready':
    case 'refresh':
      return true;
    case 'setFilter':
    case 'setConfig':
      return isObject(m.value);
    case 'setLayout':
      return Array.isArray(m.value);
    case 'command':
      return COMMAND_IDS.includes(m.id as CommandId);
    default:
      return false;
  }
}

export function isWebviewBoundMsg(m: unknown): m is WebviewBoundMsg {
  if (!isObject(m) || typeof m.type !== 'string') return false;
  switch (m.type) {
    case 'theme':
      return true;
    case 'snapshot':
      return isObject(m.payload);
    case 'config':
      return isObject(m.value);
    case 'layout':
      return Array.isArray(m.value);
    default:
      return false;
  }
}
