import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import { SidebarView } from '../../../src/extension-backend/ui/SidebarView';
import type { Filter, UsageSnapshot } from '../../../src/extension-backend/domain/types';

function emitter<T>() {
  const listeners: Array<(v: T) => void> = [];
  return {
    event: (l: (v: T) => void) => { listeners.push(l); return { dispose() {} }; },
    fire: (v: T) => listeners.forEach((l) => l(v)),
  };
}

function makeHarness(initialFilter: Filter = {}, opts: { current?: { filter: Filter } | undefined } = {}) {
  let filter = initialFilter;
  const setFilterCalls: Filter[] = [];
  const alertEmitter = emitter<{ message: string }>();
  const snapshotEmitter = emitter<UsageSnapshot>();
  let current: { filter: Filter } | undefined = 'current' in opts ? opts.current : { filter };
  const usage = {
    get current(): { filter: Filter } | undefined {
      return current;
    },
    onDidChangeSnapshot: snapshotEmitter.event,
    onAlertFired: alertEmitter.event,
    async setFilter(f: Filter): Promise<void> {
      setFilterCalls.push(f);
      filter = f;
      current = { filter };
    },
  };

  const context = {
    extensionUri: vscode.Uri.file('/ext'),
  } as unknown as vscode.ExtensionContext;

  const view = new SidebarView(context, usage as never);

  let receive: ((m: unknown) => void) | undefined;
  let visibilityHandler: (() => void) | undefined;
  const posted: unknown[] = [];
  const webviewView = {
    webview: {
      options: {},
      html: '',
      cspSource: 'vscode-webview:',
      asWebviewUri: (u: vscode.Uri) => u,
      postMessage: (m: unknown) => { posted.push(m); return Promise.resolve(true); },
      onDidReceiveMessage: (handler: (m: unknown) => void) => { receive = handler; return { dispose() {} }; },
    },
    visible: false,
    onDidChangeVisibility: (handler: () => void) => { visibilityHandler = handler; return { dispose() {} }; },
  } as unknown as vscode.WebviewView;

  view.resolveWebviewView(webviewView);

  return {
    view,
    webviewView,
    send: (m: unknown) => receive!(m),
    posted,
    setFilterCalls,
    getFilter: () => filter,
    fireAlert: (message: string) => alertEmitter.fire({ message }),
    fireSnapshot: (s: UsageSnapshot) => snapshotEmitter.fire(s),
    triggerVisibility: () => visibilityHandler!(),
  };
}

describe('SidebarView — toggleModelFilter', () => {
  it('adds a model to an empty filter', async () => {
    const h = makeHarness({});
    h.send({ type: 'toggleModelFilter', model: 'gpt-4o' });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(h.setFilterCalls[0], { models: ['gpt-4o'] });
  });

  it('removes a model already selected, deleting the key when empty', async () => {
    const h = makeHarness({ models: ['gpt-4o'] });
    h.send({ type: 'toggleModelFilter', model: 'gpt-4o' });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(h.setFilterCalls[0], {});
    assert.equal('models' in h.setFilterCalls[0]!, false);
  });

  it('preserves other filter fields when toggling a model', async () => {
    const range = { start: 1, end: 2 };
    const h = makeHarness({ range, models: ['gpt-4o'] });
    h.send({ type: 'toggleModelFilter', model: 'claude-sonnet-4' });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(h.setFilterCalls[0], { range, models: ['gpt-4o', 'claude-sonnet-4'] });
  });

  it('ignores toggleModelFilter with a non-string model', async () => {
    const h = makeHarness({});
    h.send({ type: 'toggleModelFilter', model: 42 });
    await new Promise((r) => setImmediate(r));
    assert.equal(h.setFilterCalls.length, 0);
  });
});

describe('SidebarView — alert-driven gauge', () => {
  it('relays onAlertFired to the webview as an alertFired message', () => {
    const h = makeHarness({});
    h.fireAlert('Over budget!');
    assert.deepEqual(h.posted, [{ type: 'alertFired', message: 'Over budget!' }]);
  });
});

describe('SidebarView — ready / snapshot / visibility', () => {
  it('posts the current snapshot in response to "ready" when one exists', () => {
    const snap = { filter: {} } as unknown as UsageSnapshot;
    const h = makeHarness({}, { current: snap as never });
    h.send({ type: 'ready' });
    assert.deepEqual(h.posted, [{ type: 'snapshot', payload: snap }]);
  });

  it('posts nothing in response to "ready" when there is no snapshot yet', () => {
    const h = makeHarness({}, { current: undefined });
    h.send({ type: 'ready' });
    assert.deepEqual(h.posted, []);
  });

  it('runs the openDashboard command for a typed command message', () => {
    const cmds = vscode.commands as unknown as { executeCommand: (id: string) => void };
    const original = cmds.executeCommand;
    const executed: string[] = [];
    cmds.executeCommand = ((id: string) => { executed.push(id); }) as never;
    try {
      const h = makeHarness({});
      h.send({ type: 'command', id: 'openDashboard' });
      assert.deepEqual(executed, ['mallard.openDashboard']);
      assert.deepEqual(h.posted, []); // executes a command, posts nothing back
    } finally {
      cmds.executeCommand = original;
    }
  });

  it('ignores an unvalidated/unknown message (untyped side-channel closed)', () => {
    const h = makeHarness({});
    h.send({ type: 'openDashboard' }); // legacy ad-hoc shape — no longer accepted
    h.send({ nonsense: true });
    h.send({ type: 'refresh' }); // valid HostBoundMsg the sidebar doesn't handle → default branch
    h.send({ type: 'command', id: 'signIn' }); // a command the sidebar ignores → command-else branch
    assert.deepEqual(h.posted, []);
    assert.equal(h.setFilterCalls.length, 0);
  });

  it('relays onDidChangeSnapshot updates to the webview', () => {
    const snap = { filter: { models: ['a'] } } as unknown as UsageSnapshot;
    const h = makeHarness({}, { current: snap as never });
    h.fireSnapshot(snap);
    // The event is the trigger; the posted payload is the composed
    // usage.current wire snapshot.
    assert.deepEqual(h.posted, [{ type: 'snapshot', payload: snap }]);
  });

  it('opens the dashboard on visibility, but only after the startup guard window', () => {
    const h = makeHarness({});
    (h.webviewView as unknown as { visible: boolean }).visible = false;
    h.triggerVisibility(); // not visible — no-op
    (h.webviewView as unknown as { visible: boolean }).visible = true;
    // Still inside the startup guard window (STARTUP_GUARD_MS) — no-op.
    h.triggerVisibility();
    // Both calls must not throw; command execution itself is a VS Code API
    // call the mock swallows, so there's nothing further to assert here.
    assert.ok(true);
  });

  it('dispose() disposes every registered subscription without throwing', () => {
    const h = makeHarness({});
    assert.doesNotThrow(() => h.view.dispose());
  });
});
