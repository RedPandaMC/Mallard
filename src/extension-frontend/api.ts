import { HostBoundMsg, WebviewBoundMsg, isWebviewBoundMsg } from '../extension-backend/ui/messaging';

declare function acquireVsCodeApi(): { postMessage(msg: HostBoundMsg): void };

const _vscode = acquireVsCodeApi();

export function post(msg: HostBoundMsg): void {
  _vscode.postMessage(msg);
}

type Handler = (msg: WebviewBoundMsg) => void;
const _handlers: Handler[] = [];

export function onMessage(handler: Handler): void {
  _handlers.push(handler);
}

window.addEventListener('message', (e: MessageEvent) => {
  // VS Code routes webview messages through its own bus; the origin is always
  // a vscode-webview:// URI. Reject anything else to guard against cross-frame injection.
  if (!e.origin.startsWith('vscode-webview://')) return;
  if (isWebviewBoundMsg(e.data)) {
    for (const h of _handlers) h(e.data as WebviewBoundMsg);
  }
});
