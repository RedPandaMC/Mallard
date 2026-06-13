/**
 * Compact activity-bar sidebar — uses the shared webview bundle in compact
 * mode. Pushes snapshots on change; handles open-dashboard commands.
 */
import * as vscode from 'vscode';
import { UsageService } from '../app/UsageService';
import { UserConfigStore } from '../app/UserConfigStore';
import { isHostBoundMsg } from './messaging';
import { renderHtml } from './webviewHtml';

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'weevil.sidebar';

  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly usage: UsageService,
    private readonly userConfig: UserConfigStore,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist'),
      ],
    };
    view.webview.html = renderHtml(view.webview, this.context.extensionUri, { compact: true });

    this.disposables.push(
      view.webview.onDidReceiveMessage((m) => this.onMessage(m)),
      this.usage.onDidChangeSnapshot(() => this.push()),
      this.userConfig.onDidChange((value) =>
        this.view?.webview.postMessage({ type: 'config', value }),
      ),
      vscode.window.onDidChangeActiveColorTheme(() =>
        this.view?.webview.postMessage({ type: 'theme' }),
      ),
    );
    view.onDidDispose(() => {
      this.disposables.forEach((d) => d.dispose());
      this.view = undefined;
    });

    this.push();
  }

  private onMessage(raw: unknown): void {
    if (!isHostBoundMsg(raw)) return;
    switch (raw.type) {
      case 'ready':
        this.push();
        break;
      case 'refresh':
        void this.usage.refresh();
        break;
      case 'setConfig':
        void this.userConfig.set(raw.value);
        break;
      case 'command':
        if (raw.id === 'openDashboard') {
          void vscode.commands.executeCommand('weevil.openDashboard');
        } else if (raw.id === 'signIn') {
          void this.usage.signInGitHub();
        }
        break;
      default:
        break;
    }
  }

  private push(): void {
    if (!this.view) return;
    const s = this.usage.current;
    if (s) void this.view.webview.postMessage({ type: 'snapshot', payload: s, compact: true });
    void this.view.webview.postMessage({ type: 'config', value: this.userConfig.get() });
  }
}
