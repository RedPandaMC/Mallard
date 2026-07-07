/**
 * Generic, connector-agnostic orchestrator for [[SetupRequirement]]s. Collects
 * every connector's declared prerequisites and drives one uniform flow —
 * detect → notify → enable → re-ingest — so connectors never touch VS Code UI
 * and adding a new prerequisite needs no new plumbing here.
 */
import * as vscode from 'vscode';
import type { LogConnector } from './LogConnector';
import type { SetupRequirement } from './SetupRequirement';
import { onSettingsChanged } from '../util/vscodeSettings';

export class ConnectorSetupGate implements vscode.Disposable {
  private readonly requirements: SetupRequirement[];
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    connectors: readonly LogConnector[],
    /** Called after a requirement is applied, to re-run discovery/ingest. */
    private readonly onApplied: () => void,
  ) {
    this.requirements = connectors.flatMap((c) => c.getSetupRequirements());
  }

  /** Watch the union of requirement keys and run an initial check. */
  start(): void {
    const keys = [...new Set(this.requirements.flatMap((r) => [...r.watchKeys]))];
    if (keys.length > 0) {
      this.disposables.push(onSettingsChanged(keys, () => void this.check()));
    }
    void this.check();
  }

  /** Show a one-time nudge for each unsatisfied requirement. */
  async check(): Promise<void> {
    for (const req of this.requirements) {
      if (req.isSatisfied()) continue;
      const nudgeKey = `mallard.setupNudge.${req.id}`;
      if (this.context.globalState.get<boolean>(nudgeKey)) continue;

      const choice = await vscode.window.showInformationMessage(req.detail, 'Enable', 'Not now');
      if (choice === 'Enable') {
        // Only suppress future nudges once the requirement was ACTUALLY applied.
        // A failed apply (or the write below failing) previously left the flag
        // set — permanently silencing the nudge while the prerequisite stayed
        // unsatisfied, so the connector's data never showed up and the user was
        // never prompted again.
        const applied = await this.run(req.id);
        if (applied) await this.suppressNudge(req.id);
      } else {
        // Explicit "Not now" / dismissed: it was shown once, don't nag again.
        await this.suppressNudge(req.id);
      }
    }
  }

  /**
   * Apply a requirement by id (invoked by the command / empty-state CTA).
   * Returns true when the requirement was applied successfully.
   */
  async run(id: string): Promise<boolean> {
    const req = this.requirements.find((r) => r.id === id);
    if (!req) return false;
    const result = await req.apply(this.context);
    if (!result.ok) {
      void vscode.window.showWarningMessage(result.message);
      return false;
    }
    this.onApplied();
    if (result.reloadHint) {
      const reload = await vscode.window.showInformationMessage(result.message, 'Reload Window');
      if (reload === 'Reload Window') void vscode.commands.executeCommand('workbench.action.reloadWindow');
    } else {
      void vscode.window.showInformationMessage(result.message);
    }
    return true;
  }

  /** Requirements not yet satisfied — for rendering empty-state CTAs. */
  pending(): SetupRequirement[] {
    return this.requirements.filter((r) => !r.isSatisfied());
  }

  /**
   * Marks a requirement as already nudged, without showing anything —
   * used by onboarding, which asks about the same requirement as one of
   * its own steps. Without this, the automatic one-time nudge in check()
   * would ask again the first time it runs after onboarding does.
   */
  async suppressNudge(id: string): Promise<void> {
    await this.context.globalState.update(`mallard.setupNudge.${id}`, true);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
