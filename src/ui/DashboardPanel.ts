/**
 * Full dashboard webview panel. A pure render target: pushes snapshots and
 * reacts to typed, validated inbound messages.
 */
import * as vscode from 'vscode';
import { UsageService } from '../app/UsageService';
import { UserConfigStore } from '../app/UserConfigStore';
import { Filter } from '../domain/types';
import { isHostBoundMsg, WebviewBoundMsg } from './messaging';
import { renderHtml } from './webviewHtml';

export class DashboardPanel {
  static current: DashboardPanel | undefined;
  private static readonly viewType = 'weevil.dashboard';

  private readonly disposables: vscode.Disposable[] = [];

  static show(
    context: vscode.ExtensionContext,
    usage: UsageService,
    userConfig: UserConfigStore,
  ): void {
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      'Weevil',
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
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'weevil-activitybar.svg');
    DashboardPanel.current = new DashboardPanel(panel, context, usage, userConfig);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly usage: UsageService,
    private readonly userConfig: UserConfigStore,
  ) {
    panel.webview.html = renderHtml(panel.webview, context.extensionUri, { compact: false });

    this.disposables.push(
      panel.webview.onDidReceiveMessage((m) => void this.onMessage(m)),
      usage.onDidChangeSnapshot((s) =>
        this.post({ type: 'snapshot', payload: s, compact: false }),
      ),
      userConfig.onDidChange((value) => this.post({ type: 'config', value })),
      vscode.window.onDidChangeActiveColorTheme(() => this.post({ type: 'theme' })),
      panel.onDidDispose(() => this.dispose()),
    );
  }

  private async onMessage(raw: unknown): Promise<void> {
    if (!isHostBoundMsg(raw)) return;
    switch (raw.type) {
      case 'ready': {
        const s = this.usage.current;
        if (s) this.post({ type: 'snapshot', payload: s, compact: false });
        this.post({ type: 'config', value: this.userConfig.get() });
        break;
      }
      case 'refresh':
        await this.usage.refresh();
        break;
      case 'setFilter':
        await this.usage.setFilter(raw.value as Filter);
        break;
      case 'setConfig':
        await this.userConfig.set(raw.value);
        break;
      case 'command':
        if (raw.id === 'openDashboard') {
          this.panel.reveal();
        } else if (raw.id === 'signIn') {
          void this.usage.signInGitHub();
        }
        break;
    }
  }

  private post(msg: WebviewBoundMsg): void {
    void this.panel.webview.postMessage(msg);
  }

  private dispose(): void {
    DashboardPanel.current = undefined;
    this.disposables.forEach((d) => d.dispose());
  }
}
