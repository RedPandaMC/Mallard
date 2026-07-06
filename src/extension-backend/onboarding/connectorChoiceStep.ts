import * as vscode from 'vscode';
import { detectCopilot, detectClaudeCode } from '../util/extensionDetector';
import type { OnboardingStep } from './types';

/**
 * Asks which connector(s) to track when both Copilot and Claude Code are
 * installed — with only one installed there's nothing to choose between, so
 * the step is skipped entirely rather than asking a moot question.
 */
export const connectorChoiceStep: OnboardingStep = {
  id: 'connector-choice',

  shouldShow(): boolean {
    return Boolean(detectCopilot()) && Boolean(detectClaudeCode());
  },

  async run(): Promise<boolean> {
    const picked = await vscode.window.showQuickPick(
      [
        { label: 'Both (recommended)', description: 'Track Copilot and Claude Code usage', value: ['copilot', 'claude-code'] },
        { label: 'Copilot only', description: 'Ignore Claude Code usage', value: ['copilot'] },
        { label: 'Claude Code only', description: 'Ignore Copilot usage', value: ['claude-code'] },
      ],
      {
        title: 'Mallard: which usage do you want to track?',
        placeHolder: 'Both Copilot and Claude Code are installed — pick what Mallard should ingest',
        ignoreFocusOut: true,
      },
    );
    if (!picked) return false; // dismissed — stop the whole flow

    await vscode.workspace
      .getConfiguration('mallard')
      .update('enabledConnectors', picked.value, vscode.ConfigurationTarget.Global);
    return true;
  },
};
