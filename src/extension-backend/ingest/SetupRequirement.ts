import type * as vscode from 'vscode';

export interface ApplyResult {
  readonly ok: boolean;
  /** User-facing message shown after applying (success or failure). */
  readonly message: string;
  /** True when the target needs a window reload to take effect. */
  readonly reloadHint?: boolean;
}

/**
 * A self-describing external prerequisite a connector needs in order to produce
 * data — typically an editor/extension setting that must be enabled.
 *
 * The [[ConnectorSetupGate]] reads these declaratively and drives a uniform
 * detect → notify → enable → re-ingest flow, so connectors never touch VS Code
 * UI directly and adding a new prerequisite (Copilot today, anything tomorrow)
 * needs no new plumbing.
 */
export interface SetupRequirement {
  /** Stable id — also the key for the one-time nudge guard. */
  readonly id: string;
  /** Short nudge title / empty-state CTA label. */
  readonly title: string;
  /** Longer explanation for the empty-state body. */
  readonly detail: string;
  /** Already satisfied? Reads config/env only — no side effects. */
  isSatisfied(): boolean;
  /** One-click enable: writes the settings the connector needs. */
  apply(context: vscode.ExtensionContext): Promise<ApplyResult>;
  /** Fully-qualified config keys that should trigger a re-check when changed. */
  readonly watchKeys: readonly string[];
  /** Optional docs URL describing the manual path. */
  readonly docs?: string;
}
