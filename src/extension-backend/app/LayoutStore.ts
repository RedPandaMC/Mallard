/**
 * Persists the dashboard layout (panel order, width span, visibility) in
 * globalState. Normalises stored layouts against the current panel set so
 * adding or removing a panel in a new version never breaks a saved layout.
 */
import * as vscode from 'vscode';
import { DashboardLayout } from '../domain/types';
import { normalizeLayout } from '../domain/layout';

const STORAGE_KEY = 'mallard.dashboardLayout';

export class LayoutStore implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<DashboardLayout>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly memento: vscode.Memento) {}

  get(): DashboardLayout {
    return normalizeLayout(this.memento.get<DashboardLayout>(STORAGE_KEY));
  }

  async set(layout: DashboardLayout): Promise<void> {
    const next = normalizeLayout(layout);
    await this.memento.update(STORAGE_KEY, next);
    this._onDidChange.fire(next);
  }

  async reset(): Promise<void> {
    await this.memento.update(STORAGE_KEY, undefined);
    this._onDidChange.fire(this.get());
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
