import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import { connectorChoiceStep } from '../../../src/extension-backend/onboarding/connectorChoiceStep';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const ext = vscode.extensions as Mutable<typeof vscode.extensions>;
const win = vscode.window as Mutable<typeof vscode.window>;
const ws = vscode.workspace as Mutable<typeof vscode.workspace>;

function installed(ids: string[]) {
  ext.getExtension = ((id: string) =>
    ids.includes(id) ? ({ packageJSON: { version: '1.0.0' }, isActive: true } as never) : undefined) as never;
}

describe('connectorChoiceStep', () => {
  const orig = { getExtension: ext.getExtension, showQuickPick: win.showQuickPick, getConfiguration: ws.getConfiguration };
  afterEach(() => {
    ext.getExtension = orig.getExtension;
    win.showQuickPick = orig.showQuickPick;
    ws.getConfiguration = orig.getConfiguration;
  });

  it('shouldShow is false when only one connector is installed', () => {
    installed(['github.copilot']);
    assert.equal(connectorChoiceStep.shouldShow({} as never), false);
  });

  it('shouldShow is false when neither is installed', () => {
    installed([]);
    assert.equal(connectorChoiceStep.shouldShow({} as never), false);
  });

  it('shouldShow is true when both are installed', () => {
    installed(['github.copilot', 'anthropic.claude-code']);
    assert.equal(connectorChoiceStep.shouldShow({} as never), true);
  });

  it('run() writes the picked value to mallard.enabledConnectors and returns true', async () => {
    const updates: unknown[][] = [];
    win.showQuickPick = (async (items: Array<{ value: string[] }>) => items[1]) as never;
    ws.getConfiguration = (() => ({
      get: () => undefined,
      update: (...a: unknown[]) => { updates.push(a); return Promise.resolve(); },
    })) as never;
    const proceed = await connectorChoiceStep.run({} as never);
    assert.equal(proceed, true);
    assert.deepEqual(updates[0], ['enabledConnectors', ['copilot'], vscode.ConfigurationTarget.Global]);
  });

  it('run() returns false and writes nothing when the quick pick is dismissed', async () => {
    const updates: unknown[][] = [];
    win.showQuickPick = (async () => undefined) as never;
    ws.getConfiguration = (() => ({
      get: () => undefined,
      update: (...a: unknown[]) => { updates.push(a); return Promise.resolve(); },
    })) as never;
    const proceed = await connectorChoiceStep.run({} as never);
    assert.equal(proceed, false);
    assert.equal(updates.length, 0);
  });
});
