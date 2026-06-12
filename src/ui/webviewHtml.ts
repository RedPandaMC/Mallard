/**
 * Builds the webview HTML with a strict, per-load CSP. Scripts are locked to a
 * single nonce; styles allow `unsafe-inline` (ECharts sets inline style
 * attributes on its canvas container — a style nonce would block those, so we
 * deliberately do not add one). No script nonce is ever derived from message
 * content.
 */
import * as vscode from 'vscode';
import { getNonce } from '../util/nonce';

export function renderHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  opts: { compact: boolean },
): string {
  const nonce = getNonce();
  const base = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.css'));

  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>Weevil</title>
  </head>
  <body data-compact="${opts.compact ? '1' : '0'}">
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}
