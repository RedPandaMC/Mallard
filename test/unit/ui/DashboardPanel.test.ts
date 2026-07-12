import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import { DashboardPanel } from '../../../src/extension-backend/ui/DashboardPanel';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const win = vscode.window as Mutable<typeof vscode.window> & {
  createWebviewPanel?: unknown;
};

type Listener<T> = (value: T) => void;

function emitter<T>() {
  const listeners: Listener<T>[] = [];
  return {
    event: (l: Listener<T>) => {
      listeners.push(l);
      return { dispose() {} };
    },
    fire: (v: T) => listeners.forEach((l) => l(v)),
  };
}

function makeFakePanel() {
  let disposeCb: (() => void) | undefined;
  const panel = {
    revealed: 0,
    webview: {
      html: '',
      cspSource: 'vscode-resource:',
      asWebviewUri: (u: vscode.Uri) => u,
      postMessage: () => Promise.resolve(true),
      onDidReceiveMessage: () => ({ dispose() {} }),
    },
    iconPath: undefined as unknown,
    reveal() {
      this.revealed++;
    },
    onDidDispose(fn: () => void) {
      disposeCb = fn;
      return { dispose() {} };
    },
    /** Simulate the user closing the editor tab. */
    simulateUserClose() {
      disposeCb?.();
    },
  };
  return panel;
}

function makeDeps() {
  return {
    usage: {
      current: { generatedAt: 1, budget: {} },
      refresh: async () => {},
      setFilter: async () => {},
      signInGitHub: async () => {},
      onDidChangeSnapshot: emitter<unknown>().event,
    },
    userConfig: {
      get: () => ({ monthlyBudget: 0 }),
      set: async () => {},
      uri: vscode.Uri.file('/storage/config.json'),
      onDidChange: emitter<unknown>().event,
    },
    layout: {
      get: () => [],
      set: async () => {},
      onDidChange: emitter<unknown>().event,
    },
    restriction: {
      getState: () => ({ active: false }),
      snooze: async () => {},
      onDidChange: emitter<unknown>().event,
    },
  };
}

function makeContext(): vscode.ExtensionContext {
  return {
    extensionUri: vscode.Uri.file('/ext'),
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

describe('DashboardPanel — lifecycle', () => {
  const origCreate = win.createWebviewPanel;
  let panels: ReturnType<typeof makeFakePanel>[];

  beforeEach(() => {
    panels = [];
    win.createWebviewPanel = () => {
      const p = makeFakePanel();
      panels.push(p);
      return p as never;
    };
  });
  afterEach(() => {
    // Close any panel a test left open so DashboardPanel.current resets.
    panels.forEach((p) => p.simulateUserClose());
    win.createWebviewPanel = origCreate;
  });

  it('show() creates a panel, renders CSP-locked html, and sets the icon', () => {
    const deps = makeDeps();
    DashboardPanel.show(
      makeContext(),
      deps.usage as never,
      deps.userConfig as never,
      deps.layout as never,
      deps.restriction as never,
    );
    assert.equal(panels.length, 1);
    const html = panels[0]!.webview.html;
    assert.ok(html.includes('Content-Security-Policy'), 'CSP meta present');
    assert.ok(html.includes('nonce-'), 'script nonce present');
    assert.ok(panels[0]!.iconPath, 'panel icon set');
  });

  it('a second show() reveals the existing panel instead of creating another', () => {
    const deps = makeDeps();
    const args = [
      makeContext(),
      deps.usage as never,
      deps.userConfig as never,
      deps.layout as never,
      deps.restriction as never,
    ] as const;
    DashboardPanel.show(...args);
    DashboardPanel.show(...args);
    assert.equal(panels.length, 1, 'no second panel');
    assert.equal(panels[0]!.revealed, 1, 'existing panel revealed');
  });

  it('closing the panel clears the singleton so the next show() creates a fresh one', () => {
    const deps = makeDeps();
    const args = [
      makeContext(),
      deps.usage as never,
      deps.userConfig as never,
      deps.layout as never,
      deps.restriction as never,
    ] as const;
    DashboardPanel.show(...args);
    panels[0]!.simulateUserClose();
    DashboardPanel.show(...args);
    assert.equal(panels.length, 2, 'fresh panel after close');
    assert.equal(panels[1]!.revealed, 0);
  });
});
