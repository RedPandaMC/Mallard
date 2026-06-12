/**
 * Compact activity-bar view — shares the webview bundle but renders a condensed
 * layout. "Open full dashboard" lives here too.
 */
import * as vscode from 'vscode';
import { UsageService } from '../data/UsageService';
import { runWebviewCommand } from './commandBridge';
import { isHostBoundMsg } from './messaging';
import { renderHtml } from './webviewHtml';

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'weevil.sidebar';

  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly usage: UsageService,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ],
    };
    view.webview.html = renderHtml(view.webview, this.context.extensionUri, { compact: true });

    this.disposables.push(
      view.webview.onDidReceiveMessage((m) => this.onMessage(m)),
      this.usage.onDidChangeSnapshot(() => this.push()),
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
      case 'command':
        runWebviewCommand(raw.id);
        break;
      default:
        break;
    }
  }

  private push(): void {
    const s = this.usage.current;
    if (s && this.view) {
      void this.view.webview.postMessage({
        type: 'snapshot',
        payload: s,
        compact: true,
        granularity: 'day',
      });
    }
  }
}
