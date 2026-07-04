import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import {
  detectAll,
  detectClaudeCode,
  detectCopilot,
  probeExtension,
} from '../../../src/extension-backend/util/extensionDetector';
import { defaultVscodeHost } from '../../../src/extension-backend/util/vscodeHost';
import { LayoutStore } from '../../../src/extension-backend/app/LayoutStore';
import { DASHBOARD_PANELS, DashboardLayout } from '../../../src/extension-backend/domain/types';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const ext = vscode.extensions as Mutable<typeof vscode.extensions>;
const win = vscode.window as Mutable<typeof vscode.window>;
const cmd = vscode.commands as Mutable<typeof vscode.commands>;

describe('extensionDetector', () => {
  const originalGetExtension = ext.getExtension;
  afterEach(() => { ext.getExtension = originalGetExtension; });

  function installed(ids: Record<string, { version: string; isActive: boolean }>) {
    ext.getExtension = ((id: string) => {
      const found = ids[id];
      return found
        ? { packageJSON: { version: found.version }, isActive: found.isActive }
        : undefined;
    }) as typeof ext.getExtension;
  }

  it('detects Copilot via the first matching candidate id', () => {
    installed({ 'github.copilot': { version: '1.250.0', isActive: true } });
    assert.deepEqual(detectCopilot(), { id: 'github.copilot', version: '1.250.0', isActive: true });
  });

  it('falls through to the next candidate id (copilot-chat only)', () => {
    installed({ 'github.copilot-chat': { version: '0.30.0', isActive: false } });
    assert.equal(detectCopilot()!.id, 'github.copilot-chat');
  });

  it('detects Claude Code', () => {
    installed({ 'anthropic.claude-code': { version: '2.0.1', isActive: true } });
    assert.equal(detectClaudeCode()!.id, 'anthropic.claude-code');
  });

  it('returns undefined when nothing is installed', () => {
    installed({});
    assert.equal(detectCopilot(), undefined);
    assert.equal(probeExtension({ name: 'x', ids: ['no.such'] }), undefined);
  });

  it('detectAll reports every probe with its result', () => {
    installed({ 'github.copilot': { version: '1.0.0', isActive: true } });
    const all = detectAll();
    assert.equal(all.length, 2);
    assert.equal(all[0]!.name, 'GitHub Copilot');
    assert.ok(all[0]!.result);
    assert.equal(all[1]!.result, undefined);
  });
});

describe('defaultVscodeHost', () => {
  const originalWarn = win.showWarningMessage;
  const originalExec = cmd.executeCommand;
  afterEach(() => {
    win.showWarningMessage = originalWarn;
    cmd.executeCommand = originalExec;
  });

  it('forwards showWarningMessage and executeCommand to vscode', async () => {
    const warnings: string[] = [];
    const commands: unknown[][] = [];
    win.showWarningMessage = ((msg: string) => {
      warnings.push(msg);
      return Promise.resolve(undefined);
    }) as typeof win.showWarningMessage;
    cmd.executeCommand = ((...args: unknown[]) => {
      commands.push(args);
      return Promise.resolve('done');
    }) as typeof cmd.executeCommand;

    await defaultVscodeHost.showWarningMessage('careful');
    const result = await defaultVscodeHost.executeCommand('my.cmd', 1, 'two');

    assert.deepEqual(warnings, ['careful']);
    assert.deepEqual(commands, [['my.cmd', 1, 'two']]);
    assert.equal(result, 'done');
  });
});

describe('LayoutStore', () => {
  function makeMemento(initial: Record<string, unknown> = {}) {
    const state = new Map<string, unknown>(Object.entries(initial));
    return {
      get: <T>(key: string) => state.get(key) as T | undefined,
      update: async (key: string, value: unknown) => {
        if (value === undefined) state.delete(key);
        else state.set(key, value);
      },
      keys: () => [...state.keys()],
      _state: state,
    } as unknown as vscode.Memento & { _state: Map<string, unknown> };
  }

  it('returns the default layout when nothing is stored', () => {
    const store = new LayoutStore(makeMemento());
    const layout = store.get();
    assert.equal(layout.length, DASHBOARD_PANELS.length);
    store.dispose();
  });

  it('set() persists a normalized layout and fires onDidChange', async () => {
    const memento = makeMemento();
    const store = new LayoutStore(memento);
    const fired: DashboardLayout[] = [];
    store.onDidChange((l) => fired.push(l));

    const layout = store.get();
    const reordered = [...layout].reverse();
    await store.set(reordered);

    assert.equal(fired.length, 1);
    assert.equal(store.get()[0]!.id, reordered[0]!.id);
    assert.ok(memento._state.has('mallard.dashboardLayout'));
    store.dispose();
  });

  it('reset() clears the stored layout back to defaults', async () => {
    const memento = makeMemento();
    const store = new LayoutStore(memento);
    await store.set([...store.get()].reverse());
    await store.reset();
    assert.equal(memento._state.has('mallard.dashboardLayout'), false);
    assert.equal(store.get()[0]!.id, DASHBOARD_PANELS.includes('daily') ? 'daily' : store.get()[0]!.id);
    store.dispose();
  });
});
