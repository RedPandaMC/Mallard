import * as vscode from 'vscode';

/**
 * The only two VS Code settings Weevil reads. Budget, included credits, and
 * alert thresholds live in extension globalState and are edited in the webview
 * (see {@link import('./app/UserConfigStore').UserConfigStore}).
 */
export interface WeevilConfig {
  copilotLogPath: string;
  pricingManifestUrl: string;
}

export const RELEVANT_CONFIG_KEYS = ['weevil.copilotLogPath', 'weevil.pricingManifestUrl'];

export function readConfig(): WeevilConfig {
  const c = vscode.workspace.getConfiguration('weevil');
  return {
    copilotLogPath: c.get('copilotLogPath', ''),
    pricingManifestUrl: c.get('pricingManifestUrl', ''),
  };
}
