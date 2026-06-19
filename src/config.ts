import * as vscode from 'vscode';

/**
 * The only two VS Code settings Mallard reads. Budget, included credits, and
 * alert thresholds live in extension globalState and are edited in the webview
 * (see {@link import('./app/UserConfigStore').UserConfigStore}).
 */
export interface MallardConfig {
  copilotLogPath: string;
  pricingManifestUrl: string;
}

export const RELEVANT_CONFIG_KEYS = ['mallard.copilotLogPath', 'mallard.pricingManifestUrl'];

export function readConfig(): MallardConfig {
  const c = vscode.workspace.getConfiguration('mallard');
  return {
    copilotLogPath: c.get('copilotLogPath', ''),
    pricingManifestUrl: c.get('pricingManifestUrl', ''),
  };
}
