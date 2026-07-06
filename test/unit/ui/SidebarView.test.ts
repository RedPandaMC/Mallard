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

function makeHarness(initialFilter: Filter = {}) {
  let filter = initialFilter;
  const setFilterCalls: Filter[] = [];
  const alertEmitter = emitter<{ message: string }>();
  const usage = {
    get current(): { filter: Filter } | undefined {
      return { filter };
    },
    onDidChangeSnapshot: emitter<UsageSnapshot>().event,
    onAlertFired: alertEmitter.event,
    async setFilter(f: Filter): Promise<void> {
      setFilterCalls.push(f);
      filter = f;
    },
  };

  const context = {
    extensionUri: vscode.Uri.file('/ext'),
  } as unknown as vscode.ExtensionContext;

  const view = new SidebarView(context, usage as never);

  let receive: ((m: unknown) => void) | undefined;
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
    onDidChangeVisibility: () => ({ dispose() {} }),
  } as unknown as vscode.WebviewView;

  view.resolveWebviewView(webviewView);

  return {
    send: (m: unknown) => receive!(m),
    posted,
    setFilterCalls,
    getFilter: () => filter,
    fireAlert: (message: string) => alertEmitter.fire({ message }),
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
