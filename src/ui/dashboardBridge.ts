/**
 * Shared wiring between a webview and the dashboard data + message protocol.
 * Used by both the activity-bar view and the pop-out panel so they behave
 * identically. Returns the disposables the host should clean up.
 */
import * as vscode from 'vscode';
import { UsageService } from '../app/UsageService';
import { UserConfigStore } from '../app/UserConfigStore';
import { LayoutStore } from '../app/LayoutStore';
import { Filter } from '../domain/types';
import { isHostBoundMsg, WebviewBoundMsg } from './messaging';

export interface DashboardDeps {
  usage: UsageService;
  userConfig: UserConfigStore;
  layout: LayoutStore;
}

export function bindDashboard(webview: vscode.Webview, deps: DashboardDeps): vscode.Disposable[] {
  const { usage, userConfig, layout } = deps;
  const post = (m: WebviewBoundMsg) => void webview.postMessage(m);

  const onMessage = async (raw: unknown): Promise<void> => {
    if (!isHostBoundMsg(raw)) return;
    switch (raw.type) {
      case 'ready': {
        const s = usage.current;
        if (s) post({ type: 'snapshot', payload: s });
        post({ type: 'config', value: userConfig.get() });
        post({ type: 'layout', value: layout.get() });
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
        if (raw.id === 'openDashboard') void vscode.commands.executeCommand('weevil.openDashboard');
        else if (raw.id === 'signIn') void usage.signInGitHub();
        break;
    }
  };

  return [
    webview.onDidReceiveMessage((m) => void onMessage(m)),
    usage.onDidChangeSnapshot((s) => post({ type: 'snapshot', payload: s })),
    userConfig.onDidChange((value) => post({ type: 'config', value })),
    layout.onDidChange((value) => post({ type: 'layout', value })),
    vscode.window.onDidChangeActiveColorTheme(() => post({ type: 'theme' })),
  ];
}
