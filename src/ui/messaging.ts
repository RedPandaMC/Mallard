/**
 * Typed, validated message envelopes for host <-> webview traffic.
 * Pure — no `vscode`, no DOM — so it can be bundled into both sides.
 */
import { Filter, UsageSnapshot } from '../model/types';

export type CommandId = 'openDashboard' | 'openSettings';

export type WebviewBoundMsg =
  | { type: 'snapshot'; payload: UsageSnapshot; compact: boolean }
  | { type: 'theme' };

export type HostBoundMsg =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'setFilter'; value: Filter }
  | { type: 'command'; id: CommandId };

const COMMAND_IDS: CommandId[] = ['openDashboard', 'openSettings'];

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
      return isObject(m.value);
    case 'command':
      return COMMAND_IDS.includes(m.id as CommandId);
    default:
      return false;
  }
}

export function isWebviewBoundMsg(m: unknown): m is WebviewBoundMsg {
  if (!isObject(m) || typeof m.type !== 'string') return false;
  return m.type === 'snapshot' || m.type === 'theme';
}
