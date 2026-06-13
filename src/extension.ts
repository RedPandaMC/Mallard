import * as vscode from 'vscode';
import { RELEVANT_CONFIG_KEYS } from './config';
import { buildContainer, Container } from './container';
import { defaultReportPath, generateReport } from './app/ReportGenerator';
import { DashboardPanel } from './ui/DashboardPanel';
import { SidebarViewProvider } from './ui/SidebarViewProvider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const container = await buildContainer(context);
  const { usage, userConfig } = container;

  const sidebar = new SidebarViewProvider(context, usage, userConfig);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebar),
  );

  registerCommands(context, container);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (RELEVANT_CONFIG_KEYS.some((k) => e.affectsConfiguration(k))) {
        usage.onConfigChanged();
      }
    }),
  );

  await usage.start();
}

export function deactivate(): void {
  // disposables cleaned up via context.subscriptions
}

function registerCommands(context: vscode.ExtensionContext, c: Container): void {
  const { usage, store, userConfig, layout, pricing } = c;
  const reg = (id: string, fn: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('weevil.openDashboard', () => DashboardPanel.show(context, usage, userConfig, layout));

  reg('weevil.refresh', async () => {
    await usage.refresh();
  });

  reg('weevil.clearData', async () => {
    const ok = await vscode.window.showWarningMessage(
      'Clear all Weevil data? This wipes recorded usage, your budget and alert ' +
        'settings, the saved dashboard layout, and the cached pricing manifest. ' +
        'It cannot be undone. Run this before uninstalling to leave nothing behind.',
      { modal: true },
      'Clear everything',
    );
    if (ok === 'Clear everything') {
      await store.clear();
      await userConfig.reset();
      await layout.reset();
      await pricing.clearCache();
      await usage.refresh();
    }
  });

  reg('weevil.signIn', async () => {
    await usage.signInGitHub();
  });

  reg('weevil.exportReport', async () => {
    const snapshot = usage.current;
    if (!snapshot) {
      void vscode.window.showWarningMessage('Weevil: No data available to export.');
      return;
    }
    const defaultUri = vscode.Uri.file(defaultReportPath());
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { 'HTML Report': ['html'] },
      title: 'Save Weevil Usage Report',
    });
    if (!saveUri) return;
    const html = generateReport(snapshot);
    await vscode.workspace.fs.writeFile(saveUri, Buffer.from(html, 'utf8'));
    const open = await vscode.window.showInformationMessage(
      `Report saved to ${saveUri.fsPath}`,
      'Open in Browser',
    );
    if (open === 'Open in Browser') {
      await vscode.env.openExternal(saveUri);
    }
  });

  reg('weevil.showLogPath', () => {
    const paths = usage.getLogPaths();
    if (paths.length === 0) {
      void vscode.window.showInformationMessage(
        'Weevil: No Copilot log files detected. Make sure Copilot is installed and has been used. ' +
          'You can override the path via the weevil.copilotLogPath setting.',
      );
    } else {
      void vscode.window.showInformationMessage(
        `Weevil: Watching ${paths.length} log file(s): ${paths.join(', ')}`,
      );
    }
  });
}
