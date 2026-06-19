/**
 * Activity-bar launcher. Clicking the Mallard icon in the activity bar reveals
 * this (empty) tree view, which immediately opens the dashboard in the editor
 * area. The view itself renders nothing but a welcome button (see the
 * `viewsWelcome` contribution in package.json); it exists only to turn a click
 * on the activity-bar icon into the `mallard.openDashboard` command.
 */
import * as vscode from 'vscode';

const TRIGGER_VIEW_ID = 'mallard.trigger';

/**
 * Ignore visibility events fired within this window after activation, so a
 * Mallard container that was focused when the window last closed does not
 * auto-pop the dashboard on every reload.
 */
const STARTUP_GUARD_MS = 1500;

class EmptyTreeDataProvider implements vscode.TreeDataProvider<never> {
  getChildren(): never[] {
    return [];
  }

  getTreeItem(): vscode.TreeItem {
    return new vscode.TreeItem('');
  }
}

export function registerTriggerView(): vscode.Disposable[] {
  const activatedAt = Date.now();
  const treeView = vscode.window.createTreeView(TRIGGER_VIEW_ID, {
    treeDataProvider: new EmptyTreeDataProvider(),
  });

  const visibilitySub = treeView.onDidChangeVisibility((e) => {
    if (!e.visible) return;
    if (Date.now() - activatedAt < STARTUP_GUARD_MS) return;
    void vscode.commands.executeCommand('mallard.openDashboard');
  });

  return [treeView, visibilitySub];
}
