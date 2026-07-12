import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import {
  promptReloadWindow,
  RELOAD_REQUIRED_CONFIG_KEYS,
  watchReloadRequiredSettings,
} from '../../../src/extension-backend/util/reloadPrompt';

type ConfigChangeCb = (e: { affectsConfiguration(key: string): boolean }) => void;

describe('reloadPrompt', () => {
  const ws = vscode.workspace as unknown as { onDidChangeConfiguration: unknown };
  const win = vscode.window as unknown as { showInformationMessage: unknown };
  const cmds = vscode.commands as unknown as { executeCommand: unknown };
  const orig = {
    on: ws.onDidChangeConfiguration,
    show: win.showInformationMessage,
    exec: cmds.executeCommand,
  };
  afterEach(() => {
    ws.onDidChangeConfiguration = orig.on;
    win.showInformationMessage = orig.show;
    cmds.executeCommand = orig.exec;
  });

  function arm(answer: string | undefined) {
    let cb: ConfigChangeCb | undefined;
    const shown: string[] = [];
    const executed: string[] = [];
    ws.onDidChangeConfiguration = (fn: ConfigChangeCb) => {
      cb = fn;
      return { dispose() {} };
    };
    win.showInformationMessage = (msg: string) => {
      shown.push(msg);
      return Promise.resolve(answer);
    };
    cmds.executeCommand = (id: string) => {
      executed.push(id);
      return Promise.resolve();
    };
    return { fire: (key: string) => cb?.({ affectsConfiguration: (k) => k === key }), shown, executed };
  }

  const flush = () => new Promise((r) => setImmediate(r));

  it('covers the activation-time settings', () => {
    assert.deepEqual(
      [...RELOAD_REQUIRED_CONFIG_KEYS].sort(),
      ['mallard.dataRetentionDays', 'mallard.enabledConnectors'],
    );
  });

  it('prompts and reloads when enabledConnectors changes and the user accepts', async () => {
    const h = arm('Reload Window');
    const sub = watchReloadRequiredSettings();
    h.fire('mallard.enabledConnectors');
    await flush();
    assert.equal(h.shown.length, 1, 'one prompt shown');
    assert.deepEqual(h.executed, ['workbench.action.reloadWindow']);
    sub.dispose();
  });

  it('prompts but does not reload when the user dismisses', async () => {
    const h = arm(undefined);
    const sub = watchReloadRequiredSettings();
    h.fire('mallard.dataRetentionDays');
    await flush();
    assert.equal(h.shown.length, 1);
    assert.deepEqual(h.executed, []);
    sub.dispose();
  });

  it('ignores unrelated settings', async () => {
    const h = arm('Reload Window');
    const sub = watchReloadRequiredSettings();
    h.fire('mallard.palette');
    await flush();
    assert.equal(h.shown.length, 0);
    assert.deepEqual(h.executed, []);
    sub.dispose();
  });

  it('promptReloadWindow includes the caller reason in the message', async () => {
    const h = arm(undefined);
    await promptReloadWindow('Connector choice saved.');
    assert.ok(h.shown[0]?.startsWith('Connector choice saved.'), h.shown[0] ?? 'no prompt shown');
  });
});
