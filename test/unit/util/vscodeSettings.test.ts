import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import { readSetting, writeSetting, onSettingsChanged } from '../../../src/extension-backend/util/vscodeSettings';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const ws = vscode.workspace as Mutable<typeof vscode.workspace>;

describe('vscodeSettings', () => {
  const origGet = ws.getConfiguration;
  const origOnChange = ws.onDidChangeConfiguration;
  afterEach(() => { ws.getConfiguration = origGet; ws.onDidChangeConfiguration = origOnChange; });

  it('readSetting reads section + key from the configuration', () => {
    ws.getConfiguration = ((section: string) => ({
      get: (key: string) => `${section}:${key}`,
      update: () => Promise.resolve(),
    })) as never;
    assert.equal(
      readSetting('github.copilot.chat', 'otel.exporterType'),
      'github.copilot.chat:otel.exporterType',
    );
  });

  it('writeSetting forwards key/value/target to update', async () => {
    const calls: unknown[][] = [];
    ws.getConfiguration = (() => ({
      get: () => undefined,
      update: (...args: unknown[]) => { calls.push(args); return Promise.resolve(); },
    })) as never;
    await writeSetting('mallard', 'copilotOtelPath', '/x', vscode.ConfigurationTarget.Workspace);
    assert.deepEqual(calls[0], ['copilotOtelPath', '/x', vscode.ConfigurationTarget.Workspace]);
  });

  it('writeSetting defaults to the Global target', async () => {
    let target: unknown;
    ws.getConfiguration = (() => ({
      get: () => undefined,
      update: (_k: string, _v: unknown, t: unknown) => { target = t; return Promise.resolve(); },
    })) as never;
    await writeSetting('mallard', 'x', 'y');
    assert.equal(target, vscode.ConfigurationTarget.Global);
  });

  it('onSettingsChanged fires only for watched keys', () => {
    let handler: (e: { affectsConfiguration(k: string): boolean }) => void = () => {};
    ws.onDidChangeConfiguration = ((cb: typeof handler) => { handler = cb; return { dispose() {} }; }) as never;
    let fired = 0;
    const d = onSettingsChanged(['a.b', 'c.d'], () => { fired++; });
    handler({ affectsConfiguration: (k) => k === 'c.d' });
    assert.equal(fired, 1);
    handler({ affectsConfiguration: () => false });
    assert.equal(fired, 1);
    d.dispose();
  });
});
