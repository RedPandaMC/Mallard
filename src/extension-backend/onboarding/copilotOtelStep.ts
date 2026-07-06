import * as vscode from 'vscode';
import { detectCopilot } from '../util/extensionDetector';
import type { OnboardingContext, OnboardingStep } from './types';

function copilotEnabled(): boolean {
  const enabled = vscode.workspace.getConfiguration('mallard').get<string[]>('enabledConnectors');
  return !enabled || enabled.includes('copilot');
}

/**
 * If Copilot is the (or a) connector being tracked and its OTel exporter
 * isn't enabled yet, offers to enable it — reusing the same
 * ConnectorSetupGate/CopilotOtelRequirement machinery the standing
 * "Enable Copilot Usage Tracking" command and empty-state CTA use, so
 * there's exactly one place that knows how to satisfy this requirement.
 */
export const copilotOtelStep: OnboardingStep = {
  id: 'copilot-otel',

  shouldShow(ctx: OnboardingContext): boolean {
    if (!copilotEnabled() || !detectCopilot()) return false;
    return ctx.setupGate.pending().some((r) => r.id === 'copilot-otel');
  },

  async run(ctx: OnboardingContext): Promise<boolean> {
    const req = ctx.setupGate.pending().find((r) => r.id === 'copilot-otel');
    if (!req) return true;
    const choice = await vscode.window.showInformationMessage(req.detail, 'Enable', 'Not now');
    if (choice === 'Enable') await ctx.setupGate.run('copilot-otel');
    // Onboarding already asked — don't let the gate's standing automatic
    // nudge (ConnectorSetupGate.check()) ask again the next time it runs.
    await ctx.setupGate.suppressNudge('copilot-otel');
    return true;
  },
};
