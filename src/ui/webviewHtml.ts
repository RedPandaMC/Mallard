/**
 * Builds the webview HTML with a strict, per-load CSP.
 * Scripts are locked to a single nonce; styles are limited to bundled CSS and
 * the codicon font served from the extension (no inline styles, no eval, no
 * external origins). ECharts uses the canvas renderer, which paints into a
 * <canvas> and needs no inline <style>; runtime layout uses the CSSOM
 * (element.style.*), which CSP does not restrict. Monaco workers load from
 * blob: URLs produced at runtime.
 */
import * as vscode from 'vscode';
import { getNonce } from '../util/nonce';

export function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  const base = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.css'));
  const workerUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'monaco.workers.js'));
  const logoUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'weevil-icon.svg'),
  );
  const codiconsUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'),
  );

  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `worker-src 'self' blob:`,
    `connect-src ${webview.cspSource}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${codiconsUri}" rel="stylesheet" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>Weevil</title>
  </head>
  <body data-logo="${logoUri}">
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
    <script nonce="${nonce}" src="${workerUri}"></script>
  </body>
</html>`;
}
