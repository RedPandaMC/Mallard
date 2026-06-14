import * as vscode from 'vscode';
import { RELEVANT_CONFIG_KEYS } from './config';
import { buildContainer, Container } from './container';
import { defaultReportPath, generateReport } from './app/ReportGenerator';
import { DashboardPanel } from './ui/DashboardPanel';
import { Value } from './domain/expr/ast';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const container = await buildContainer(context);
  const { usage, restriction } = container;

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'weevil.openDashboard';
  context.subscriptions.push(statusBar);
  const updateStatusBar = () => {
    const s = usage.current;
    const auth = s?.authStatus ?? 'signed-out';
    const r = restriction.getState();
    if (r.active) {
      statusBar.text = `$(shield) Copilot restricted`;
      statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      statusBar.tooltip = r.reasonMessage;
      statusBar.show();
    } else if (r.userOverrideUntil && r.userOverrideUntil > Date.now()) {
      const m = Math.max(1, Math.round((r.userOverrideUntil - Date.now()) / 60_000));
      statusBar.text = `$(debug-pause) Weevil · override ${m}m`;
      statusBar.backgroundColor = undefined;
      statusBar.tooltip = 'Restriction rule is being overridden.';
      statusBar.show();
    } else if (auth === 'signed-in') {
      statusBar.text = `$(verified-filled) ${s?.githubBilling?.quota?.plan ?? 'GitHub'}`;
      statusBar.backgroundColor = undefined;
      statusBar.tooltip = 'Open Weevil dashboard';
      statusBar.show();
    } else if (auth === 'signed-out') {
      statusBar.text = '$(account) Sign in to GitHub';
      statusBar.backgroundColor = undefined;
      statusBar.tooltip = 'Click to sign in to GitHub for billing verification';
      statusBar.show();
    } else {
      statusBar.hide();
    }
  };
  updateStatusBar();
  context.subscriptions.push(usage.onDidChangeSnapshot(updateStatusBar));
  context.subscriptions.push(restriction.onDidChange(updateStatusBar));

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
  const { usage, store, userConfig, layout, pricing, restriction } = c;
  const reg = (id: string, fn: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('weevil.openDashboard', () =>
    DashboardPanel.show(context, usage, userConfig, layout, restriction),
  );

  reg('weevil.refresh', async () => {
    await usage.refresh();
  });

  reg('weevil.clearData', async () => {
    const ok = await vscode.window.showWarningMessage(
      'Clear all Weevil data? This wipes recorded usage, your budget and alert ' +
        'settings, the saved dashboard layout, the cached pricing manifest, and ' +
        'any active restriction. It cannot be undone. Run this before ' +
        'uninstalling to leave nothing behind.',
      { modal: true },
      'Clear everything',
    );
    if (ok === 'Clear everything') {
      await store.clear();
      await userConfig.reset();
      await layout.reset();
      await pricing.clearCache();
      await restriction.clearAll();
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

  reg('weevil.showLogPath', async () => {
    const paths = usage.getLogPaths();
    if (paths.length > 0) {
      void vscode.window.showInformationMessage(
        `Weevil: Watching ${paths.length} log file(s): ${paths.join(', ')}`,
      );
      return;
    }
    const searched = usage.getSearchedDirs();
    const known = usage.getKnownDirs();
    const tried = searched.length > 0 ? searched : known;
    const detail =
      tried.length > 0 ? `\n\nSearched:\n${tried.map((p) => '  ' + p).join('\n')}` : '';
    const pick = await vscode.window.showInformationMessage(
      'Weevil: No Copilot log files detected. Make sure Copilot is installed and has been used. ' +
        'You can override the path via the weevil.copilotLogPath setting.' +
        detail,
      'Pick log folder…',
    );
    if (pick) {
      const uri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Use this folder',
        title: 'Select Copilot log folder',
      });
      if (uri && uri[0]) {
        await vscode.workspace
          .getConfiguration('weevil')
          .update('copilotLogPath', uri[0].fsPath, vscode.ConfigurationTarget.Global);
        await usage.refresh();
      }
    }
  });

  reg('weevil.simulateRestriction', async () => {
    const snapshot = usage.current;
    const cfg = userConfig.get();
    const report = await restriction.simulate({
      snapshot: snapshot ?? null,
      rules: cfg.rules ?? [],
      ...(cfg.vars !== undefined ? { vars: cfg.vars as Record<string, Value> } : {}),
      ...(cfg.groups !== undefined ? { groups: cfg.groups } : {}),
      signedIn: snapshot?.authStatus === 'signed-in',
    });
    const channel = vscode.window.createOutputChannel('Weevil Restriction');
    channel.clear();
    channel.appendLine(JSON.stringify(report, null, 2));
    channel.show(true);
  });
}
