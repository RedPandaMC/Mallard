import { HostBoundMsg, WebviewBoundMsg, isWebviewBoundMsg } from '../src/extension/ui/messaging';

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
  if (isWebviewBoundMsg(e.data)) {
    for (const h of _handlers) h(e.data as WebviewBoundMsg);
  }
});
