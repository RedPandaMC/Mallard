import * as vscode from 'vscode';
import { Metric, StatusBarScope } from './model/types';
import { NotificationRule } from './notify/rules';

export interface WeevilConfig {
  dataSource: 'auto' | 'sample' | 'local';
  monthlyBudget: number;
  currency: string;
  pricePerCredit: number;
  includedCredits: number;
  modelMultipliers: Record<string, number>;
  copilotLogPath: string;
  refreshIntervalMinutes: number;
  statusBarMetric: Metric;
  statusBarScope: StatusBarScope;
  petEnabled: boolean;
  notifications: NotificationRule[];
}

/** Settings keys that should trigger a refresh when changed. */
export const RELEVANT_CONFIG_KEYS = [
  'weevil.dataSource',
  'weevil.monthlyBudget',
  'weevil.currency',
  'weevil.pricePerCredit',
  'weevil.includedCredits',
  'weevil.tokenPricing',
  'weevil.copilotLogPath',
  'weevil.refreshIntervalMinutes',
  'weevil.statusBar.metric',
  'weevil.statusBar.scope',
  'weevil.notifications',
];

export function readConfig(): WeevilConfig {
  const c = vscode.workspace.getConfiguration('weevil');
  const tokenPricing = c.get<Record<string, { creditMultiplier?: number }>>('tokenPricing', {});
  const modelMultipliers: Record<string, number> = {};
  for (const [k, v] of Object.entries(tokenPricing)) {
    if (v && typeof v.creditMultiplier === 'number') modelMultipliers[k] = v.creditMultiplier;
  }

  return {
    dataSource: c.get('dataSource', 'auto'),
    monthlyBudget: c.get('monthlyBudget', 0),
    currency: c.get('currency', 'USD'),
    pricePerCredit: c.get('pricePerCredit', 0.04),
    includedCredits: c.get('includedCredits', 300),
    modelMultipliers,
    copilotLogPath: c.get('copilotLogPath', ''),
    refreshIntervalMinutes: c.get('refreshIntervalMinutes', 15),
    statusBarMetric: c.get('statusBar.metric', 'cost'),
    statusBarScope: c.get('statusBar.scope', 'today'),
    petEnabled: c.get('pet.enabled', true),
    notifications: c.get('notifications', []),
  };
}
