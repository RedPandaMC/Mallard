/**
 * Shared wiring between a webview and the dashboard data + message protocol.
 * Used by both the activity-bar view and the pop-out panel so they behave
 * identically. Returns the disposables the host should clean up.
 */
import * as vscode from 'vscode';
import { UsageService } from '../app/UsageService';
import { UserConfigStore } from '../app/UserConfigStore';
import { LayoutStore } from '../app/LayoutStore';
import { RestrictionEngine } from '../domain/restriction/engine';
import { Filter } from '../domain/types';
import { readConfig } from '../config';
import { isHostBoundMsg, ThemeKind, WebviewBoundMsg } from './messaging';

export interface DashboardDeps {
  usage: UsageService;
  userConfig: UserConfigStore;
  layout: LayoutStore;
  restriction: RestrictionEngine;
}

function themeKind(): ThemeKind {
  switch (vscode.window.activeColorTheme.kind) {
    case vscode.ColorThemeKind.Light:
      return 'light';
    case vscode.ColorThemeKind.HighContrast:
      return 'high-contrast';
    case vscode.ColorThemeKind.HighContrastLight:
      return 'high-contrast-light';
    default:
      return 'dark';
  }
}

/** The theme message carries the active theme kind and the palette setting —
 *  the two inputs the webview needs to derive an accessible accent. */
function themeMsg(): WebviewBoundMsg {
  return { type: 'theme', kind: themeKind(), palette: readConfig().palette };
}

export function bindDashboard(webview: vscode.Webview, deps: DashboardDeps): vscode.Disposable[] {
  const { usage, userConfig, layout, restriction } = deps;
  const post = (m: WebviewBoundMsg) => void webview.postMessage(m);

  const onMessage = async (raw: unknown): Promise<void> => {
    if (!isHostBoundMsg(raw)) return;
    switch (raw.type) {
      case 'ready': {
        const s = usage.current;
        if (s) post({ type: 'snapshot', payload: s });
        post({ type: 'config', value: userConfig.get() });
        post({ type: 'layout', value: layout.get() });
        post({ type: 'restriction', value: restriction.getState() });
        post(themeMsg());
        break;
      }
      case 'refresh':
        await usage.refresh();
        break;
      case 'setFilter':
        await usage.setFilter(raw.value as Filter);
        break;
      case 'setConfig':
        await userConfig.set(raw.value);
        break;
      case 'setLayout':
        await layout.set(raw.value);
        break;
      case 'openConfig':
        await vscode.window.showTextDocument(userConfig.uri);
        break;
      case 'command':
        if (raw.id === 'openDashboard') void vscode.commands.executeCommand('mallard.openDashboard');
        else if (raw.id === 'signIn') void usage.signInGitHub();
        else if (raw.id === 'disableExtension') {
          void vscode.commands.executeCommand('mallard.disableExtension');
        } else if (raw.id === 'enableCopilotTelemetry') {
          void vscode.commands.executeCommand('mallard.enableCopilotTelemetry');
        } else if (raw.id === 'setGitHubPat') {
          void vscode.commands.executeCommand('mallard.setGitHubPat');
        }
        break;
      case 'restrictSnooze':
        await restriction.snooze(raw.minutes);
        break;
      case 'setCurrency':
        // Currency is dashboard-editable, so it's persisted in UserConfigStore
        // (the authoritative store for dashboard config) rather than VS Code
        // settings. Writing here fires userConfig.onDidChange, which recomputes
        // the snapshot immediately — the old settings.json write could lag.
        await userConfig.set({ currency: (raw.value || 'USD').trim().toUpperCase() || 'USD' });
        break;
    }
  };

  return [
    webview.onDidReceiveMessage((m) => void onMessage(m)),
    usage.onDidChangeSnapshot((s) => post({ type: 'snapshot', payload: s })),
    userConfig.onDidChange((value) => post({ type: 'config', value })),
    layout.onDidChange((value) => post({ type: 'layout', value })),
    restriction.onDidChange((value) => post({ type: 'restriction', value })),
    vscode.window.onDidChangeActiveColorTheme(() => post(themeMsg())),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('mallard.palette')) post(themeMsg());
    }),
  ];
}
