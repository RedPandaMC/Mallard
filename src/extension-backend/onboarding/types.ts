import type * as vscode from 'vscode';
import type { ConnectorSetupGate } from '../ingest/ConnectorSetupGate';

/** Shared state every onboarding step can read from. Keep this small and
 *  additive — steps should read persisted state (settings, globalState),
 *  not depend on what an earlier step did in memory, so new steps can be
 *  inserted or removed without reworking the flow. */
export interface OnboardingContext {
  readonly context: vscode.ExtensionContext;
  readonly setupGate: ConnectorSetupGate;
}

/**
 * One page of the onboarding flow. The runner below drives an ordered list
 * of these — add a new file implementing this interface and append it to
 * `ONBOARDING_STEPS` (see steps.ts) to extend the flow; no other code needs
 * to change.
 */
export interface OnboardingStep {
  /** Stable id, used only for logging/diagnostics. */
  readonly id: string;
  /** Whether this step is relevant right now (reads config/env only). */
  shouldShow(ctx: OnboardingContext): Promise<boolean> | boolean;
  /**
   * Run the step's UI. Return `true` to continue to the next step, or
   * `false` to stop the whole flow — e.g. the user pressed Escape/closed
   * the quick pick, which should dismiss onboarding entirely rather than
   * barrel on to unrelated follow-up steps.
   */
  run(ctx: OnboardingContext): Promise<boolean>;
}

/** Runs each step in order, stopping early if any step signals dismissal. */
export async function runOnboarding(
  steps: readonly OnboardingStep[],
  ctx: OnboardingContext,
): Promise<void> {
  for (const step of steps) {
    if (!(await step.shouldShow(ctx))) continue;
    const proceed = await step.run(ctx);
    if (!proceed) return;
  }
}
