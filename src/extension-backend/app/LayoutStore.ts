/**
 * Dashboard layout access, backed by config.json's `dashboard.panels` block —
 * the single source of truth. Normalises against the current panel set so adding or
 * removing a panel in a new version never breaks a saved layout.
 */
import * as vscode from 'vscode';
import { DashboardLayout } from '../domain/types';
import { configPanelsToLayout, layoutToConfigPanels } from '../domain/layout';
import { UserConfigStore } from './UserConfigStore';

export class LayoutStore implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<DashboardLayout>();
  readonly onDidChange = this._onDidChange.event;

  private lastJson: string;
  private readonly sub: vscode.Disposable;

  constructor(private readonly userConfig: UserConfigStore) {
    this.lastJson = JSON.stringify(this.get());
    // config.json is also hand-editable and watched — re-emit only when the
    // layout actually changed so unrelated config edits don't reflow the grid.
    this.sub = userConfig.onDidChange(() => {
      const next = this.get();
      const json = JSON.stringify(next);
      if (json !== this.lastJson) {
        this.lastJson = json;
        this._onDidChange.fire(next);
      }
    });
  }

  get(): DashboardLayout {
    return configPanelsToLayout(this.userConfig.get().dashboard?.panels);
  }

  async set(layout: DashboardLayout): Promise<void> {
    await this.userConfig.set({
      dashboard: {
        ...this.userConfig.get().dashboard,
        panels: layoutToConfigPanels(layout),
      },
    });
  }

  async reset(): Promise<void> {
    await this.userConfig.set({
      dashboard: { ...this.userConfig.get().dashboard, panels: [] },
    });
  }

  dispose(): void {
    this.sub.dispose();
    this._onDidChange.dispose();
  }
}
