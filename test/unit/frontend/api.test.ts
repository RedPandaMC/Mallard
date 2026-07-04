import { strict as assert } from 'assert';
import { post, onMessage } from '../../../src/extension-frontend/api';
import type { WebviewBoundMsg } from '../../../src/extension-backend/ui/messaging';

describe('frontend/api — postMessage + message routing', () => {
  it('post() delegates to acquireVsCodeApi().postMessage', () => {
    const posted = (globalThis as unknown as { __postedMessages: unknown[] }).__postedMessages ?? [];
    const before = posted.length;
    post({ type: 'refresh' });
    assert.equal(posted.length, before + 1);
    assert.deepEqual(posted.at(-1), { type: 'refresh' });
  });

  it('onMessage receives messages with a vscode-webview:// origin', () => {
    const received: WebviewBoundMsg[] = [];
    onMessage((m) => received.push(m));
    const event = new window.MessageEvent('message', {
      origin: 'vscode-webview://abc',
      data: { type: 'snapshot', payload: { generatedAt: 1 } },
    });
    window.dispatchEvent(event);
    assert.equal(received.length, 1);
    assert.equal(received[0]!.type, 'snapshot');
  });

  it('onMessage rejects messages with a non-vscode origin', () => {
    const received: WebviewBoundMsg[] = [];
    onMessage((m) => received.push(m));
    const event = new window.MessageEvent('message', {
      origin: 'https://evil.com',
      data: { type: 'snapshot', payload: {} },
    });
    window.dispatchEvent(event);
    assert.equal(received.length, 0);
  });

  it('onMessage ignores non-webview-bound messages', () => {
    const received: WebviewBoundMsg[] = [];
    onMessage((m) => received.push(m));
    const event = new window.MessageEvent('message', {
      origin: 'vscode-webview://abc',
      data: { not: 'a valid message' },
    });
    window.dispatchEvent(event);
    assert.equal(received.length, 0);
  });
});
