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
}

export const RELEVANT_CONFIG_KEYS = [
  'mallard.copilotLogPath',
  'mallard.pricingManifestUrl',
  'mallard.palette',
];

export function readConfig(): MallardConfig {
  const c = vscode.workspace.getConfiguration('mallard');
  return {
    copilotLogPath: c.get('copilotLogPath', ''),
    pricingManifestUrl: c.get('pricingManifestUrl', ''),
    palette: c.get<string>('palette', 'swiss') === 'theme' ? 'theme' : 'swiss',
  };
}
