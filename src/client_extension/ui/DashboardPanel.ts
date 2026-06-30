/**
 * Pop-out dashboard panel. A pure render target: the shared dashboard bridge
 * pushes data and handles inbound messages; this just owns the panel lifecycle.
 */
import * as vscode from 'vscode';
import { UsageService } from '../app/UsageService';
import { UserConfigStore } from '../app/UserConfigStore';
import { LayoutStore } from '../app/LayoutStore';
import { RestrictionEngine } from '../domain/restriction/engine';
import { bindDashboard } from './dashboardBridge';
import { renderHtml } from './webviewHtml';

export class DashboardPanel {
  static current: DashboardPanel | undefined;
  private static readonly viewType = 'mallard.dashboard';

  private readonly disposables: vscode.Disposable[] = [];

  static show(
    context: vscode.ExtensionContext,
    usage: UsageService,
    userConfig: UserConfigStore,
    layout: LayoutStore,
    restriction: RestrictionEngine,
  ): void {
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      'Mallard',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'),
          vscode.Uri.joinPath(context.extensionUri, 'media'),
          vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist'),
        ],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'mallard-icon-128.png');
    DashboardPanel.current = new DashboardPanel(panel, context, {
      usage,
      userConfig,
      layout,
      restriction,
    });
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    deps: {
      usage: UsageService;
      userConfig: UserConfigStore;
      layout: LayoutStore;
      restriction: RestrictionEngine;
    },
  ) {
    panel.webview.html = renderHtml(panel.webview, context.extensionUri);
    this.disposables.push(
      ...bindDashboard(panel.webview, deps),
      panel.onDidDispose(() => this.dispose()),
    );
  }

  private dispose(): void {
    DashboardPanel.current = undefined;
    this.disposables.forEach((d) => d.dispose());
  }
}
