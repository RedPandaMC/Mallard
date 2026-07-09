import * as vscode from 'vscode';
import type { ConnectorSetupGate } from '../ingest/ConnectorSetupGate';
import { runOnboarding, type OnboardingStep } from './types';
import { connectorChoiceStep } from './connectorChoiceStep';
import { copilotOtelStep } from './copilotOtelStep';
import { FLAG_ONBOARDING_COMPLETED, getFlag, setFlag } from '../app/EphemeralFlags';

/**
 * Ordered onboarding steps. Append here (and add a new file implementing
 * OnboardingStep) to extend the flow — nothing else needs to change.
 */
const ONBOARDING_STEPS: readonly OnboardingStep[] = [connectorChoiceStep, copilotOtelStep];

/** Runs the flow once ever, on first activation. Marks itself complete
 *  before running so a mid-flow crash doesn't re-trigger it — the flow
 *  stays reachable afterward via the "Mallard: Show Onboarding" command. */
export async function runOnboardingIfNeeded(
  context: vscode.ExtensionContext,
  setupGate: ConnectorSetupGate,
): Promise<void> {
  if (getFlag(context.globalState, FLAG_ONBOARDING_COMPLETED)) return;
  await setFlag(context.globalState, FLAG_ONBOARDING_COMPLETED);
  await runOnboarding(ONBOARDING_STEPS, { context, setupGate });
}

/** Manual re-invocation via the command palette, regardless of whether
 *  onboarding already ran. */
export async function showOnboarding(
  context: vscode.ExtensionContext,
  setupGate: ConnectorSetupGate,
): Promise<void> {
  await runOnboarding(ONBOARDING_STEPS, { context, setupGate });
}
