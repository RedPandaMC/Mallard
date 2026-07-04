import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import { bindDashboard, DashboardDeps } from '../../../src/extension-backend/ui/dashboardBridge';
import type { WebviewBoundMsg } from '../../../src/extension-backend/ui/messaging';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const win = vscode.window as Mutable<typeof vscode.window>;
const cmd = vscode.commands as Mutable<typeof vscode.commands>;

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

function makeHarness() {
  const posted: WebviewBoundMsg[] = [];
  let receive: ((m: unknown) => void) | undefined;
  const webview = {
    postMessage: (m: WebviewBoundMsg) => {
      posted.push(m);
      return Promise.resolve(true);
    },
    onDidReceiveMessage: (handler: (m: unknown) => void) => {
      receive = handler;
      return { dispose() {} };
    },
  } as unknown as vscode.Webview;

  const snapshotEmitter = emitter<unknown>();
  const calls: Record<string, unknown[][]> = {
    refresh: [], setFilter: [], signIn: [], setConfig: [], setLayout: [], snooze: [],
  };

  const deps = {
    usage: {
      current: { generatedAt: 1, budget: {} },
      refresh: async (...a: unknown[]) => void calls.refresh!.push(a),
      setFilter: async (...a: unknown[]) => void calls.setFilter!.push(a),
      signInGitHub: async (...a: unknown[]) => void calls.signIn!.push(a),
      onDidChangeSnapshot: snapshotEmitter.event,
    },
    userConfig: {
      get: () => ({ monthlyBudget: 0 }),
      set: async (...a: unknown[]) => void calls.setConfig!.push(a),
      uri: vscode.Uri.file('/storage/config.json'),
      onDidChange: emitter<unknown>().event,
    },
    layout: {
      get: () => [],
      set: async (...a: unknown[]) => void calls.setLayout!.push(a),
      onDidChange: emitter<unknown>().event,
    },
    restriction: {
      getState: () => ({ active: false }),
      snooze: async (...a: unknown[]) => void calls.snooze!.push(a),
      onDidChange: emitter<unknown>().event,
    },
  } as unknown as DashboardDeps;

  const disposables = bindDashboard(webview, deps);
  return { posted, send: (m: unknown) => receive!(m), calls, snapshotEmitter, disposables };
}

describe('dashboardBridge — message routing', () => {
  it('answers "ready" with snapshot, config, layout, restriction, and theme', async () => {
    const h = makeHarness();
    h.send({ type: 'ready' });
    await Promise.resolve();
    assert.deepEqual(
      h.posted.map((m) => m.type),
      ['snapshot', 'config', 'layout', 'restriction', 'theme'],
    );
    const theme = h.posted.at(-1) as Extract<WebviewBoundMsg, { type: 'theme' }>;
    assert.equal(theme.kind, 'dark'); // mock activeColorTheme.kind = Dark
    assert.equal(theme.palette, 'swiss');
  });

  it('skips the snapshot on "ready" when none is computed yet', async () => {
    // Rebuild with no current snapshot
    const posted: WebviewBoundMsg[] = [];
    let receive: ((m: unknown) => void) | undefined;
    const webview = {
      postMessage: (m: WebviewBoundMsg) => (posted.push(m), Promise.resolve(true)),
      onDidReceiveMessage: (handler: (m: unknown) => void) => ((receive = handler), { dispose() {} }),
    } as unknown as vscode.Webview;
    const deps = {
      usage: { current: undefined, onDidChangeSnapshot: emitter<unknown>().event },
      userConfig: { get: () => ({}), uri: vscode.Uri.file('/x'), onDidChange: emitter<unknown>().event },
      layout: { get: () => [], onDidChange: emitter<unknown>().event },
      restriction: { getState: () => ({ active: false }), onDidChange: emitter<unknown>().event },
    } as unknown as DashboardDeps;
    bindDashboard(webview, deps);
    receive!({ type: 'ready' });
    await Promise.resolve();
    assert.deepEqual(posted.map((m) => m.type), ['config', 'layout', 'restriction', 'theme']);
  });

  it('routes refresh, setFilter, setConfig, setLayout, and restrictSnooze', async () => {
    const h = makeHarness();
    h.send({ type: 'refresh' });
    h.send({ type: 'setFilter', value: { models: ['gpt-4o'] } });
    h.send({ type: 'setConfig', value: { monthlyBudget: 5 } });
    h.send({ type: 'setLayout', value: [] });
    h.send({ type: 'restrictSnooze', minutes: 15 });
    await new Promise((r) => setImmediate(r));

    assert.equal(h.calls.refresh!.length, 1);
    assert.deepEqual(h.calls.setFilter![0], [{ models: ['gpt-4o'] }]);
    assert.deepEqual(h.calls.setConfig![0], [{ monthlyBudget: 5 }]);
    assert.equal(h.calls.setLayout!.length, 1);
    assert.deepEqual(h.calls.snooze![0], [15]);
  });

  it('routes command messages to the right host actions', async () => {
    const executed: string[] = [];
    const originalExec = cmd.executeCommand;
    cmd.executeCommand = ((id: string) => {
      executed.push(id);
      return Promise.resolve(undefined);
    }) as typeof cmd.executeCommand;
    try {
      const h = makeHarness();
      h.send({ type: 'command', id: 'openDashboard' });
      h.send({ type: 'command', id: 'disableExtension' });
      h.send({ type: 'command', id: 'signIn' });
      await new Promise((r) => setImmediate(r));
      assert.deepEqual(executed, ['mallard.openDashboard', 'mallard.disableExtension']);
      assert.equal(h.calls.signIn!.length, 1);
    } finally {
      cmd.executeCommand = originalExec;
    }
  });

  it('opens the config file for openConfig', async () => {
    const opened: unknown[] = [];
    const originalShow = win.showTextDocument;
    win.showTextDocument = ((uri: unknown) => {
      opened.push(uri);
      return Promise.resolve(undefined);
    }) as unknown as typeof win.showTextDocument;
    try {
      const h = makeHarness();
      h.send({ type: 'openConfig' });
      await new Promise((r) => setImmediate(r));
      assert.equal(opened.length, 1);
    } finally {
      win.showTextDocument = originalShow;
    }
  });

  it('ignores malformed messages entirely', async () => {
    const h = makeHarness();
    h.send(null);
    h.send({ type: 'sudo', value: 'rm -rf' });
    h.send({ type: 'restrictSnooze', minutes: -5 });
    await new Promise((r) => setImmediate(r));
    assert.equal(h.posted.length, 0);
    assert.equal(h.calls.snooze!.length, 0);
  });

  it('forwards snapshot updates from the usage service to the webview', () => {
    const h = makeHarness();
    h.snapshotEmitter.fire({ generatedAt: 2 });
    assert.equal(h.posted.length, 1);
    assert.equal(h.posted[0]!.type, 'snapshot');
  });

  it('returns disposables for every subscription', () => {
    const h = makeHarness();
    assert.equal(h.disposables.length, 7);
    for (const d of h.disposables) assert.doesNotThrow(() => d.dispose());
  });
});
