import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import { renderHtml } from '../../../src/extension-backend/ui/webviewHtml';

function makeWebview() {
  return {
    cspSource: 'https://webview.test',
    asWebviewUri: (uri: vscode.Uri) => ({
      toString: () => `vscode-resource:${uri.fsPath}`,
    }),
  } as unknown as vscode.Webview;
}

const extensionUri = vscode.Uri.file('/ext');

describe('renderHtml — webview shell + CSP', () => {
  it('locks scripts to a nonce that matches the script tag', () => {
    const html = renderHtml(makeWebview(), extensionUri);
    const cspNonce = /script-src 'nonce-([^']+)'/.exec(html)?.[1];
    const tagNonce = /<script nonce="([^"]+)"/.exec(html)?.[1];
    assert.ok(cspNonce, 'CSP must carry a script nonce');
    assert.equal(cspNonce, tagNonce, 'script tag nonce must match the CSP nonce');
  });

  it('generates a fresh nonce per render', () => {
    const a = /'nonce-([^']+)'/.exec(renderHtml(makeWebview(), extensionUri))?.[1];
    const b = /'nonce-([^']+)'/.exec(renderHtml(makeWebview(), extensionUri))?.[1];
    assert.notEqual(a, b);
  });

  it("denies everything by default and never allows external origins", () => {
    const html = renderHtml(makeWebview(), extensionUri);
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)![1]!;
    assert.ok(csp.includes("default-src 'none'"));
    for (const directive of ['img-src', 'font-src', 'style-src', 'connect-src']) {
      assert.ok(csp.includes(`${directive} https://webview.test`), `${directive} must be limited to the webview source`);
    }
    assert.ok(!csp.includes('http://'), 'no plaintext origins');
    assert.ok(!/unsafe-eval/.test(csp), 'no eval');
  });

  it('references the bundled webview assets through asWebviewUri', () => {
    const html = renderHtml(makeWebview(), extensionUri);
    assert.ok(html.includes('vscode-resource:/ext/dist/webview/main.js'));
    assert.ok(html.includes('vscode-resource:/ext/dist/webview/main.css'));
    assert.ok(html.includes('vscode-resource:/ext/media/mallard-icon-128.png'));
    assert.ok(html.includes('codicon.css'));
  });
});
