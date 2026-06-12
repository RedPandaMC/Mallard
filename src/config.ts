import * as vscode from 'vscode';

export interface WeevilConfig {
  copilotLogPath: string;
  includedCredits: number;
  monthlyBudget: number;
  alertDailyCredits: number;
  pricingManifestUrl: string;
}

export const RELEVANT_CONFIG_KEYS = [
  'weevil.copilotLogPath',
  'weevil.includedCredits',
  'weevil.monthlyBudget',
  'weevil.alert.dailyCredits',
];

export function readConfig(): WeevilConfig {
  const c = vscode.workspace.getConfiguration('weevil');
  return {
    copilotLogPath: c.get('copilotLogPath', ''),
    includedCredits: c.get('includedCredits', 300),
    monthlyBudget: c.get('monthlyBudget', 0),
    alertDailyCredits: c.get('alert.dailyCredits', 0),
    pricingManifestUrl: c.get('pricingManifestUrl', ''),
  };
}
