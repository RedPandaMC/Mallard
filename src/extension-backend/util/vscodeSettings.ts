/**
 * Thin, connector-agnostic wrappers over VS Code's configuration API. Setup
 * requirements ([[SetupRequirement]]) read/write *external* extension settings
 * (e.g. Copilot's OTel export) through these helpers rather than bespoke code,
 * so adding a new prerequisite needs no new plumbing.
 */
import * as vscode from 'vscode';

/** Read a setting: `readSetting('github.copilot.chat', 'otel.exporterType')`. */
export function readSetting<T>(section: string, key: string): T | undefined {
  return vscode.workspace.getConfiguration(section).get<T>(key);
}

/** Write a setting (defaults to the Global target). */
export function writeSetting(
  section: string,
  key: string,
  value: unknown,
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
): Thenable<void> {
  return vscode.workspace.getConfiguration(section).update(key, value, target);
}

/** Invoke `cb` when any of the fully-qualified `keys` changes. */
export function onSettingsChanged(keys: readonly string[], cb: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (keys.some((k) => e.affectsConfiguration(k))) cb();
  });
}
