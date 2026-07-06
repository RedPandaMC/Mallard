import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import { ConnectorSetupGate } from '../../../src/extension-backend/ingest/ConnectorSetupGate';
import type { LogConnector } from '../../../src/extension-backend/ingest/LogConnector';
import type { ApplyResult, SetupRequirement } from '../../../src/extension-backend/ingest/SetupRequirement';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const win = vscode.window as Mutable<typeof vscode.window>;
const cmds = vscode.commands as Mutable<typeof vscode.commands>;
const ws = vscode.workspace as Mutable<typeof vscode.workspace>;

function fakeReq(over: Partial<SetupRequirement> & { id: string }): SetupRequirement {
  return {
    id: over.id,
    title: over.title ?? 'title',
    detail: over.detail ?? 'detail',
    watchKeys: over.watchKeys ?? [`k.${over.id}`],
    isSatisfied: over.isSatisfied ?? (() => false),
    apply: over.apply ?? (async (): Promise<ApplyResult> => ({ ok: true, message: 'done' })),
  };
}

function connectorWith(reqs: SetupRequirement[]): LogConnector {
  return { getSetupRequirements: () => reqs } as unknown as LogConnector;
}

function fakeContext(store = new Map<string, unknown>()): vscode.ExtensionContext {
  return {
    globalState: {
      get: (k: string) => store.get(k),
      update: async (k: string, v: unknown) => { store.set(k, v); },
    },
  } as unknown as vscode.ExtensionContext;
}

describe('ConnectorSetupGate', () => {
  const orig = {
    info: win.showInformationMessage,
    warn: win.showWarningMessage,
    exec: cmds.executeCommand,
    onChange: ws.onDidChangeConfiguration,
  };
  afterEach(() => {
    win.showInformationMessage = orig.info;
    win.showWarningMessage = orig.warn;
    cmds.executeCommand = orig.exec;
    ws.onDidChangeConfiguration = orig.onChange;
  });

  it('start() registers a watcher for requirement keys and runs an initial check', async () => {
    let registered = false;
    ws.onDidChangeConfiguration = (() => { registered = true; return { dispose() {} }; }) as never;
    const info: string[] = [];
    win.showInformationMessage = (async (m: string) => { info.push(m); return undefined; }) as never;
    const gate = new ConnectorSetupGate(fakeContext(), [connectorWith([fakeReq({ id: 'a', detail: 'enable A' })])], () => {});
    gate.start();
    await new Promise((r) => setImmediate(r));
    assert.ok(registered, 'watches config for requirement keys');
    assert.deepEqual(info, ['enable A']);
    gate.dispose();
  });

  it('start() skips the watcher when there are no requirements', () => {
    let registered = false;
    ws.onDidChangeConfiguration = (() => { registered = true; return { dispose() {} }; }) as never;
    const gate = new ConnectorSetupGate(fakeContext(), [connectorWith([])], () => {});
    gate.start();
    assert.equal(registered, false);
    gate.dispose();
  });

  it('check() nudges once, then never again (globalState guard)', async () => {
    const store = new Map<string, unknown>();
    let shown = 0;
    win.showInformationMessage = (async () => { shown++; return undefined; }) as never;
    const gate = new ConnectorSetupGate(fakeContext(store), [connectorWith([fakeReq({ id: 'a' })])], () => {});
    await gate.check();
    await gate.check();
    assert.equal(shown, 1, 'nudge shown only once');
  });

  it('check() skips satisfied requirements', async () => {
    let shown = 0;
    win.showInformationMessage = (async () => { shown++; return undefined; }) as never;
    const gate = new ConnectorSetupGate(fakeContext(), [connectorWith([fakeReq({ id: 'a', isSatisfied: () => true })])], () => {});
    await gate.check();
    assert.equal(shown, 0);
  });

  it('check() applies the requirement when the user clicks Enable', async () => {
    let applied = false;
    win.showInformationMessage = (async () => 'Enable') as never;
    const req = fakeReq({ id: 'a', apply: async () => { applied = true; return { ok: true, message: 'ok' }; } });
    const gate = new ConnectorSetupGate(fakeContext(), [connectorWith([req])], () => {});
    await gate.check();
    assert.equal(applied, true);
  });

  it('run() applies, calls onApplied, and prompts to reload when hinted', async () => {
    let onApplied = 0;
    const execs: string[] = [];
    cmds.executeCommand = (async (id: string) => { execs.push(id); }) as never;
    win.showInformationMessage = (async () => 'Reload Window') as never;
    const req = fakeReq({ id: 'a', apply: async () => ({ ok: true, message: 'ok', reloadHint: true }) });
    const gate = new ConnectorSetupGate(fakeContext(), [connectorWith([req])], () => { onApplied++; });
    await gate.run('a');
    assert.equal(onApplied, 1);
    assert.deepEqual(execs, ['workbench.action.reloadWindow']);
  });

  it('run() does not reload when the user dismisses the reload prompt', async () => {
    const execs: string[] = [];
    cmds.executeCommand = (async (id: string) => { execs.push(id); }) as never;
    win.showInformationMessage = (async () => undefined) as never;
    const req = fakeReq({ id: 'a', apply: async () => ({ ok: true, message: 'ok', reloadHint: true }) });
    const gate = new ConnectorSetupGate(fakeContext(), [connectorWith([req])], () => {});
    await gate.run('a');
    assert.deepEqual(execs, []);
  });

  it('run() shows an info toast when no reload is needed', async () => {
    const info: string[] = [];
    win.showInformationMessage = (async (m: string) => { info.push(m); return undefined; }) as never;
    const req = fakeReq({ id: 'a', apply: async () => ({ ok: true, message: 'applied' }) });
    const gate = new ConnectorSetupGate(fakeContext(), [connectorWith([req])], () => {});
    await gate.run('a');
    assert.deepEqual(info, ['applied']);
  });

  it('run() warns and skips onApplied when apply fails', async () => {
    let onApplied = 0;
    const warns: string[] = [];
    win.showWarningMessage = (async (m: string) => { warns.push(m); return undefined; }) as never;
    const req = fakeReq({ id: 'a', apply: async () => ({ ok: false, message: 'nope' }) });
    const gate = new ConnectorSetupGate(fakeContext(), [connectorWith([req])], () => { onApplied++; });
    await gate.run('a');
    assert.deepEqual(warns, ['nope']);
    assert.equal(onApplied, 0);
  });

  it('run() is a no-op for an unknown id', async () => {
    const gate = new ConnectorSetupGate(fakeContext(), [connectorWith([fakeReq({ id: 'a' })])], () => {});
    await gate.run('does-not-exist'); // must not throw
  });

  it('suppressNudge() marks a requirement nudged without showing anything, so check() skips it', async () => {
    let shown = 0;
    win.showInformationMessage = (async () => { shown++; return undefined; }) as never;
    const gate = new ConnectorSetupGate(fakeContext(), [connectorWith([fakeReq({ id: 'a' })])], () => {});
    await gate.suppressNudge('a');
    await gate.check();
    assert.equal(shown, 0, 'nudge already suppressed — check() must not show it');
  });

  it('pending() lists only unsatisfied requirements', () => {
    const gate = new ConnectorSetupGate(
      fakeContext(),
      [connectorWith([fakeReq({ id: 'a', isSatisfied: () => true }), fakeReq({ id: 'b', isSatisfied: () => false })])],
      () => {},
    );
    assert.deepEqual(gate.pending().map((r) => r.id), ['b']);
  });
});
