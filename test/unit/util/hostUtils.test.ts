import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  detectAll,
  detectClaudeCode,
  detectCopilot,
  probeExtension,
} from '../../../src/extension-backend/util/extensionDetector';
import { defaultVscodeHost } from '../../../src/extension-backend/util/vscodeHost';
import { LayoutStore } from '../../../src/extension-backend/app/LayoutStore';
import { UserConfigStore } from '../../../src/extension-backend/app/UserConfigStore';
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

describe('LayoutStore (config.json-backed)', () => {
  async function makeStore() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mallard-layout-'));
    const userConfig = new UserConfigStore(dir);
    return { dir, userConfig, store: new LayoutStore(userConfig) };
  }

  it('returns the default layout when nothing is stored', async () => {
    const { store, userConfig } = await makeStore();
    const layout = store.get();
    assert.equal(layout.length, DASHBOARD_PANELS.length);
    store.dispose();
    userConfig.dispose();
  });

  it('set() persists a normalized layout into config.json and fires onDidChange', async () => {
    const { dir, store, userConfig } = await makeStore();
    const fired: DashboardLayout[] = [];
    store.onDidChange((l) => fired.push(l));

    const reordered = [...store.get()].reverse();
    await store.set(reordered);

    assert.equal(fired.length, 1);
    assert.equal(store.get()[0]!.id, reordered[0]!.id);
    const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'config.json'), 'utf8'));
    assert.equal(onDisk.dashboard.panels[0].id, reordered[0]!.id);
    store.dispose();
    userConfig.dispose();
  });

  it('reset() restores the default layout', async () => {
    const { store, userConfig } = await makeStore();
    await store.set([...store.get()].reverse());
    await store.reset();
    assert.deepEqual(store.get().map((p) => p.id), [...DASHBOARD_PANELS]);
    store.dispose();
    userConfig.dispose();
  });

  it('does not re-fire onDidChange for config edits that leave the layout unchanged', async () => {
    const { store, userConfig } = await makeStore();
    const fired: DashboardLayout[] = [];
    store.onDidChange((l) => fired.push(l));
    await userConfig.set({ monthlyBudget: 42 });
    assert.equal(fired.length, 0);
    store.dispose();
    userConfig.dispose();
  });
});
