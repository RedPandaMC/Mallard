/**
 * Some settings are only read at activation (the connector registry and the
 * event store are built once in the container). Changing them used to be a
 * silent no-op until the next manual reload — surface that instead of leaving
 * the user wondering why nothing happened.
 */
import * as vscode from 'vscode';
import { onSettingsChanged } from './vscodeSettings';

/** Settings that only take effect at activation. */
export const RELOAD_REQUIRED_CONFIG_KEYS = [
  'mallard.enabledConnectors',
  'mallard.dataRetentionDays',
] as const;

/** Offer a window reload; applies immediately if the user accepts. */
export async function promptReloadWindow(reason: string): Promise<void> {
  const reload = 'Reload Window';
  const choice = await vscode.window.showInformationMessage(
    `${reason} Reload the window to apply.`,
    reload,
  );
  if (choice === reload) {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}

/** Prompt for a reload whenever an activation-time setting changes. */
export function watchReloadRequiredSettings(): vscode.Disposable {
  return onSettingsChanged(RELOAD_REQUIRED_CONFIG_KEYS, () =>
    void promptReloadWindow('A Mallard setting that applies at startup changed.'),
  );
}
