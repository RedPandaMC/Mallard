import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import { copilotOtelStep } from '../../../src/extension-backend/onboarding/copilotOtelStep';
import type { OnboardingContext } from '../../../src/extension-backend/onboarding/types';
import type { SetupRequirement } from '../../../src/extension-backend/ingest/SetupRequirement';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const ext = vscode.extensions as Mutable<typeof vscode.extensions>;
const win = vscode.window as Mutable<typeof vscode.window>;
const ws = vscode.workspace as Mutable<typeof vscode.workspace>;

function installed(ids: string[]) {
  ext.getExtension = ((id: string) =>
    ids.includes(id) ? ({ packageJSON: { version: '1.0.0' }, isActive: true } as never) : undefined) as never;
}

function config(enabledConnectors?: string[]) {
  ws.getConfiguration = (() => ({
    get: () => enabledConnectors,
    update: () => Promise.resolve(),
  })) as never;
}

const otelReq = { id: 'copilot-otel', detail: 'Enable it?' } as unknown as SetupRequirement;

function fakeCtx(pending: SetupRequirement[], suppressed: string[] = [], ran: string[] = []): OnboardingContext {
  return {
    setupGate: {
      pending: () => pending,
      run: async (id: string) => { ran.push(id); },
      suppressNudge: async (id: string) => { suppressed.push(id); },
    },
  } as unknown as OnboardingContext;
}

describe('copilotOtelStep', () => {
  const orig = { getExtension: ext.getExtension, getConfiguration: ws.getConfiguration, showInformationMessage: win.showInformationMessage };
  afterEach(() => {
    ext.getExtension = orig.getExtension;
    ws.getConfiguration = orig.getConfiguration;
    win.showInformationMessage = orig.showInformationMessage;
  });

  it('shouldShow is false when Copilot is not installed', () => {
    installed([]);
    config(undefined);
    assert.equal(copilotOtelStep.shouldShow(fakeCtx([otelReq])), false);
  });

  it('shouldShow is false when copilot is excluded from enabledConnectors', () => {
    installed(['github.copilot']);
    config(['claude-code']);
    assert.equal(copilotOtelStep.shouldShow(fakeCtx([otelReq])), false);
  });

  it('shouldShow is false when the requirement is already satisfied', () => {
    installed(['github.copilot']);
    config(undefined);
    assert.equal(copilotOtelStep.shouldShow(fakeCtx([])), false);
  });

  it('shouldShow is true when Copilot is installed, enabled, and OTel is unsatisfied', () => {
    installed(['github.copilot']);
    config(undefined);
    assert.equal(copilotOtelStep.shouldShow(fakeCtx([otelReq])), true);
  });

  it('run() applies the requirement on "Enable" and always suppresses the standing nudge', async () => {
    win.showInformationMessage = (async () => 'Enable') as never;
    const suppressed: string[] = [];
    const ran: string[] = [];
    const proceed = await copilotOtelStep.run(fakeCtx([otelReq], suppressed, ran));
    assert.equal(proceed, true);
    assert.deepEqual(ran, ['copilot-otel']);
    assert.deepEqual(suppressed, ['copilot-otel']);
  });

  it('run() does not apply on "Not now", but still suppresses the standing nudge', async () => {
    win.showInformationMessage = (async () => 'Not now') as never;
    const suppressed: string[] = [];
    const ran: string[] = [];
    const proceed = await copilotOtelStep.run(fakeCtx([otelReq], suppressed, ran));
    assert.equal(proceed, true);
    assert.deepEqual(ran, []);
    assert.deepEqual(suppressed, ['copilot-otel']);
  });

  it('run() is a no-op when the requirement is no longer pending', async () => {
    const suppressed: string[] = [];
    const ran: string[] = [];
    const proceed = await copilotOtelStep.run(fakeCtx([], suppressed, ran));
    assert.equal(proceed, true);
    assert.deepEqual(suppressed, []);
  });
});
