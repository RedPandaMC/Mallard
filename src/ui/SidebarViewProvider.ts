/**
 * Activity-bar view. Renders the full dashboard (embedded) using the shared
 * dashboard bridge; a pop-out button opens the same dashboard in an editor tab.
 */
import * as vscode from 'vscode';
import { UsageService } from '../app/UsageService';
import { UserConfigStore } from '../app/UserConfigStore';
import { LayoutStore } from '../app/LayoutStore';
import { bindDashboard } from './dashboardBridge';
import { renderHtml } from './webviewHtml';

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'weevil.sidebar';

  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly usage: UsageService,
    private readonly userConfig: UserConfigStore,
    private readonly layout: LayoutStore,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist'),
      ],
    };
    view.webview.html = renderHtml(view.webview, this.context.extensionUri, { embedded: true });

    this.disposables = bindDashboard(view.webview, {
      usage: this.usage,
      userConfig: this.userConfig,
      layout: this.layout,
    });
    view.onDidDispose(() => {
      this.disposables.forEach((d) => d.dispose());
      this.disposables = [];
    });
  }
}
