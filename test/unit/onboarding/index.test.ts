import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import { runOnboardingIfNeeded, showOnboarding } from '../../../src/extension-backend/onboarding';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const ext = vscode.extensions as Mutable<typeof vscode.extensions>;
const win = vscode.window as Mutable<typeof vscode.window>;

function fakeContext(store = new Map<string, unknown>()): vscode.ExtensionContext {
  return {
    globalState: {
      get: (k: string) => store.get(k),
      update: async (k: string, v: unknown) => { store.set(k, v); },
    },
  } as unknown as vscode.ExtensionContext;
}

const fakeSetupGate = { pending: () => [], run: async () => {}, suppressNudge: async () => {} } as never;

describe('onboarding — runOnboardingIfNeeded / showOnboarding', () => {
  const orig = { getExtension: ext.getExtension, showQuickPick: win.showQuickPick };
  afterEach(() => {
    ext.getExtension = orig.getExtension;
    win.showQuickPick = orig.showQuickPick;
  });

  it('runs the flow on first call and marks it complete', async () => {
    ext.getExtension = (() => undefined) as never; // no connectors installed -> no steps show
    const store = new Map<string, unknown>();
    const context = fakeContext(store);
    await runOnboardingIfNeeded(context, fakeSetupGate);
    assert.equal(store.get('mallard.onboardingCompleted'), true);
  });

  it('does not run again once marked complete', async () => {
    let quickPickCalls = 0;
    win.showQuickPick = (async () => { quickPickCalls++; return undefined; }) as never;
    ext.getExtension = ((id: string) =>
      ['github.copilot', 'anthropic.claude-code'].includes(id) ? ({ packageJSON: { version: '1' }, isActive: true } as never) : undefined) as never;
    const store = new Map<string, unknown>([['mallard.onboardingCompleted', true]]);
    const context = fakeContext(store);
    await runOnboardingIfNeeded(context, fakeSetupGate);
    assert.equal(quickPickCalls, 0, 'already completed — must not show anything');
  });

  it('showOnboarding re-runs the flow regardless of the completed flag', async () => {
    let quickPickCalls = 0;
    win.showQuickPick = (async () => { quickPickCalls++; return undefined; }) as never;
    ext.getExtension = ((id: string) =>
      ['github.copilot', 'anthropic.claude-code'].includes(id) ? ({ packageJSON: { version: '1' }, isActive: true } as never) : undefined) as never;
    const store = new Map<string, unknown>([['mallard.onboardingCompleted', true]]);
    const context = fakeContext(store);
    await showOnboarding(context, fakeSetupGate);
    assert.equal(quickPickCalls, 1, 'manual re-invocation always runs the flow');
  });
});
