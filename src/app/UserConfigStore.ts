/**
 * Persists user-editable config (budget, included credits, alert thresholds) in
 * extension globalState rather than settings.json, so it can be edited entirely
 * from the webview. Fires onDidChange whenever the config is updated.
 */
import * as vscode from 'vscode';
import { DEFAULT_USER_CONFIG, UserConfig } from '../domain/types';

const STORAGE_KEY = 'weevil.userConfig';

export class UserConfigStore implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<UserConfig>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly memento: vscode.Memento) {
    this.migrateLegacySettings();
  }

  get(): UserConfig {
    const stored = this.memento.get<Partial<UserConfig>>(STORAGE_KEY);
    return mergeConfig(stored);
  }

  async set(patch: Partial<UserConfig>): Promise<void> {
    const next = mergeConfig({ ...this.get(), ...patch });
    await this.memento.update(STORAGE_KEY, next);
    this._onDidChange.fire(next);
  }

  /**
   * One-time seed: if nothing is stored yet but the user still has non-default
   * values in the legacy settings keys, carry them over so upgrades are seamless.
   */
  private migrateLegacySettings(): void {
    if (this.memento.get(STORAGE_KEY) !== undefined) return;
    const c = vscode.workspace.getConfiguration('weevil');
    const monthlyBudget = c.get<number>('monthlyBudget', 0);
    const includedCredits = c.get<number>('includedCredits', 300);
    const dailyCreditAlert = c.get<number>('alert.dailyCredits', 0);
    if (monthlyBudget === 0 && includedCredits === 300 && dailyCreditAlert === 0) return;
    void this.memento.update(
      STORAGE_KEY,
      mergeConfig({ monthlyBudget, includedCredits, dailyCreditAlert }),
    );
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

/** Merge a stored partial over defaults, clamping numbers to be non-negative. */
export function mergeConfig(stored?: Partial<UserConfig>): UserConfig {
  const d = DEFAULT_USER_CONFIG;
  const nonNeg = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
  return {
    monthlyBudget: nonNeg(stored?.monthlyBudget, d.monthlyBudget),
    includedCredits: nonNeg(stored?.includedCredits, d.includedCredits),
    dailyCreditAlert: nonNeg(stored?.dailyCreditAlert, d.dailyCreditAlert),
    alerts: {
      velocityEnabled:
        typeof stored?.alerts?.velocityEnabled === 'boolean'
          ? stored.alerts.velocityEnabled
          : d.alerts.velocityEnabled,
      velocityCreditsPerHour: nonNeg(
        stored?.alerts?.velocityCreditsPerHour,
        d.alerts.velocityCreditsPerHour,
      ),
    },
  };
}
