import * as vscode from 'vscode';
import { PaletteMode } from './domain/types';

/**
 * The VS Code settings Mallard reads. Budget, included credits, and alert
 * thresholds live in extension globalState and are edited in the webview
 * (see {@link import('./app/UserConfigStore').UserConfigStore}).
 */
export interface MallardConfig {
  copilotLogPath: string;
  pricingManifestUrl: string;
  palette: PaletteMode;
  /** Minutes between automatic log re-reads and snapshot refreshes. Default 10. */
  refreshIntervalMinutes: number;
  /** Days of raw per-request events to retain before rolling up. Default 90. */
  dataRetentionDays: number;
  metricExport: {
    brokerUrl: string;
    topic: string;
    username: string;
    password: string;
    certPath: string;
    keyPath: string;
    caPath: string;
  };
}

export const RELEVANT_CONFIG_KEYS = [
  'mallard.copilotLogPath',
  'mallard.pricingManifestUrl',
  'mallard.palette',
  'mallard.refreshIntervalMinutes',
  'mallard.dataRetentionDays',
];

export function readConfig(): MallardConfig {
  const c = vscode.workspace.getConfiguration('mallard');
  return {
    copilotLogPath: c.get('copilotLogPath', ''),
    pricingManifestUrl: c.get('pricingManifestUrl', ''),
    palette: c.get<string>('palette', 'swiss') === 'theme' ? 'theme' : 'swiss',
    refreshIntervalMinutes: Math.max(1, Math.min(60, c.get('refreshIntervalMinutes', 10))),
    dataRetentionDays: Math.max(30, Math.min(365, c.get('dataRetentionDays', 90))),
    metricExport: {
      brokerUrl: c.get('metricExport.brokerUrl', ''),
      topic: c.get('metricExport.topic', 'mallard/metrics'),
      username: c.get('metricExport.username', ''),
      password: c.get('metricExport.password', ''),
      certPath: c.get('metricExport.certPath', ''),
      keyPath: c.get('metricExport.keyPath', ''),
      caPath: c.get('metricExport.caPath', ''),
    },
  };
}
