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
        break;
      case 'restrictSnooze':
        await restriction.snooze(raw.minutes);
        break;
      case 'restrictNow':
        await restriction.snooze(0);
        // Re-apply by clearing the grace window: a fresh reconcile will be
        // a no-op since the rule is already active; trigger one manually.
        {
          const s = usage.current;
          const cfg = userConfig.get();
          await restriction.reconcile({
            snapshot: s ?? null,
            rules: cfg.rules ?? [],
            ...(cfg.vars !== undefined
              ? { vars: cfg.vars as Record<string, import('../domain/expr/ast').Value> }
              : {}),
            ...(cfg.groups !== undefined ? { groups: cfg.groups } : {}),
            signedIn: s?.authStatus === 'signed-in',
          });
        }
        break;
      case 'restrictPermanent':
        // Set the user override to a far-future timestamp.
        await restriction.snooze(60 * 24 * 365 * 10);
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
