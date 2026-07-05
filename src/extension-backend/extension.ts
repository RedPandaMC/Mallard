import * as vscode from 'vscode';
import { RELEVANT_CONFIG_KEYS } from './config';
import { buildContainer, Container } from './container';
import {
  ALL_SECRET_KEYS,
  CREDENTIAL_SLOTS,
  SECRET_KEYS,
  exportTargetSlots,
  manageCredentials,
  promptAndStoreSecret,
} from './app/credentials';
import { defaultReportPath, generateReport } from './app/ReportGenerator';
import { DashboardPanel } from './ui/DashboardPanel';
import { SidebarView } from './ui/SidebarView';
import { cleanupGlobalState, cleanupStorage } from './app/Lifecycle';
import { formatCredits } from './domain/format';
import { severityFor } from './domain/budget';

let _context: vscode.ExtensionContext | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  _context = context;
  let container: import('./container').Container;
  try {
    container = await buildContainer(context);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(
      `Mallard failed to start: ${msg}. Check the Output panel (Mallard) for details.`,
    );
    return;
  }
  const { usage, restriction, ingest, userConfig } = container;

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'mallard.openDashboard';
  context.subscriptions.push(statusBar);
  const updateStatusBar = () => {
    const s = usage.current;
    const auth = s?.authStatus ?? 'signed-out';
    const r = restriction.getState();
    if (r.active) {
      statusBar.text = `$(shield) Usage limit reached`;
      statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      statusBar.tooltip = r.reasonMessage;
      statusBar.show();
    } else if (r.userOverrideUntil && r.userOverrideUntil > Date.now()) {
      const m = Math.max(1, Math.round((r.userOverrideUntil - Date.now()) / 60_000));
      statusBar.text = `$(debug-pause) Mallard · override ${m}m`;
      statusBar.backgroundColor = undefined;
      statusBar.tooltip = 'Restriction rule is being overridden.';
      statusBar.show();
    } else if (s) {
      const cr = formatCredits(s.today.credits);
      const severity = severityFor(s.budget);
      statusBar.backgroundColor =
        severity === 'error'   ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : severity === 'warning' ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
      // eslint-disable-next-line security/detect-possible-timing-attacks -- auth is an AuthStatus enum, not a secret
      if (auth === 'signed-in') {
        const plan = s.githubBilling?.quota?.plan ?? 'GitHub';
        statusBar.text = `$(verified-filled) ${plan} · ${cr} cr`;
      } else {
        statusBar.text = `$(graph) ${cr} cr today`;
      }
      const mtdCr = formatCredits(s.budget.usedCredits);
      statusBar.tooltip = new vscode.MarkdownString(`**Today:** ${cr} cr\n\n**MTD:** ${mtdCr} cr`);
      statusBar.show();
    } else {
      // No snapshot yet — show sign-in prompt (auth is 'signed-out' when s is undefined)
      statusBar.text = '$(account) Sign in to GitHub';
      statusBar.backgroundColor = undefined;
      statusBar.tooltip = 'Click to sign in to GitHub for billing verification';
      statusBar.show();
    }
  };
  updateStatusBar();
  context.subscriptions.push(usage.onDidChangeSnapshot(updateStatusBar));
  context.subscriptions.push(restriction.onDidChange(updateStatusBar));

  context.subscriptions.push(
    restriction.onDidChange(async (state) => {
      if (!state.active) return;
      const cfg = userConfig.get();
      const rule = cfg.rules?.find((r) => r.id === state.ruleId);
      if (!rule?.restrict) return;
      const msg = state.reasonMessage || 'Copilot usage limit reached.';
      const choice = await vscode.window.showWarningMessage(
        `Mallard · ${msg}`, 'Dismiss', 'Snooze 15m', 'Snooze 1h', 'Disable Mallard…',
      );
      if (choice === 'Snooze 15m') await restriction.snooze(15);
      if (choice === 'Snooze 1h') await restriction.snooze(60);
      if (choice === 'Disable Mallard…') {
        await vscode.commands.executeCommand('mallard.disableExtension');
      }
    }),
  );

  registerCommands(context, container);
  const sidebar = new SidebarView(context, usage);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarView.viewType, sidebar),
    { dispose: () => sidebar.dispose() },
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (RELEVANT_CONFIG_KEYS.some((k) => e.affectsConfiguration(k))) {
        if (e.affectsConfiguration('mallard.copilotLogPath')) {
          void usage.refresh();
        } else {
          usage.onConfigChanged();
        }
      }
    }),
  );

  await usage.start();
  container.setupGate.start();

  if (vscode.env.remoteName && !context.globalState.get<boolean>('mallard.remoteCopilotWarned')) {
    const d = usage.onDidChangeSnapshot(() => {
      d.dispose();
      if (ingest.getConnectorLogPaths('copilot').length === 0) {
        void vscode.window.showWarningMessage(
          'Mallard: Running in a remote session. GitHub Copilot usage logs are on your local ' +
          'machine and cannot be read here. Claude Code usage is tracked normally. ' +
          'See the Mallard docs for details.',
          'Learn more',
          "Don't show again",
        ).then(async (choice) => {
          if (choice === 'Learn more') {
            await vscode.env.openExternal(
              vscode.Uri.parse('https://redpandamc.github.io/Mallard/guide/troubleshooting#remote-ssh'),
            );
          }
          if (choice === "Don't show again") {
            await context.globalState.update('mallard.remoteCopilotWarned', true);
          }
        });
      }
    });
    context.subscriptions.push(d);
  }
}

export async function deactivate(): Promise<void> {
  if (!_context) return;
  // context.subscriptions are disposed by VS Code before deactivate() is called,
  // so EventStore.dispose() (which closes the DuckDB connection) runs first.
  // It is then safe to delete the database files.
  await cleanupStorage(_context.globalStorageUri.fsPath);
  await cleanupGlobalState(_context.globalState);
}

function registerCommands(context: vscode.ExtensionContext, c: Container): void {
  const { usage, store, userConfig, layout, pricing, restriction, setupGate } = c;
  const reg = (id: string, fn: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('mallard.enableCopilotTelemetry', async () => {
    await setupGate.run('copilot-otel');
  });

  reg('mallard.openDashboard', () => {
    try {
      DashboardPanel.show(context, usage, userConfig, layout, restriction);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Mallard: Could not open dashboard — ${msg}`);
    }
  });

  reg('mallard.refresh', async () => {
    await usage.refresh();
  });

  reg('mallard.clearData', async () => {
    const ok = await vscode.window.showWarningMessage(
      'Clear all Mallard data? This wipes recorded usage, your budget and alert ' +
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

  reg('mallard.signIn', async () => {
    await usage.signInGitHub();
  });

  reg('mallard.exportReport', async () => {
    const snapshot = usage.current;
    if (!snapshot) {
      void vscode.window.showWarningMessage('Mallard: No data available to export.');
      return;
    }
    const defaultUri = vscode.Uri.file(defaultReportPath());
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { 'HTML Report': ['html'] },
      title: 'Save Mallard Usage Report',
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

  reg('mallard.showLogPath', async () => {
    const paths = usage.getLogPaths();
    if (paths.length > 0) {
      void vscode.window.showInformationMessage(
        `Mallard: Watching ${paths.length} log file(s): ${paths.join(', ')}`,
      );
      return;
    }
    const searched = usage.getSearchedDirs();
    const known = usage.getKnownDirs();
    const tried = searched.length > 0 ? searched : known;
    const detail =
      tried.length > 0 ? `\n\nSearched:\n${tried.map((p) => '  ' + p).join('\n')}` : '';
    const pick = await vscode.window.showInformationMessage(
      'Mallard: No Copilot or Claude Code log files detected. Make sure one of them is installed ' +
        'and has been used. Copilot\'s log directory can be overridden via the mallard.copilotLogPath ' +
        'setting.' +
        detail,
      'Pick Copilot log folder…',
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
          .getConfiguration('mallard')
          .update('copilotLogPath', uri[0].fsPath, vscode.ConfigurationTarget.Global);
        await usage.refresh();
      }
    }
  });

  reg('mallard.simulateRestriction', async () => {
    const snapshot = usage.current;
    const cfg = userConfig.get();
    const report = await restriction.simulate({
      snapshot: snapshot ?? null,
      rules: cfg.rules ?? [],
      ...(cfg.vars !== undefined ? { vars: cfg.vars } : {}),
      ...(cfg.groups !== undefined ? { groups: cfg.groups } : {}),
      signedIn: snapshot?.authStatus === 'signed-in',
    });
    const channel = vscode.window.createOutputChannel('Mallard Restriction');
    channel.clear();
    channel.appendLine(JSON.stringify(report, null, 2));
    channel.show(true);
  });

  reg('mallard.exportData', async () => {
    const saveUri = await vscode.window.showSaveDialog({
      filters: { CSV: ['csv'], JSON: ['json'] },
      title: 'Export Mallard Usage Data',
    });
    if (!saveUri) return;
    const ext = saveUri.fsPath.split('.').pop()?.toLowerCase();
    const format = ext === 'json' ? 'json' : 'csv';
    await store.reader.exportTo(saveUri.fsPath, format as 'csv' | 'json');
    void vscode.window.showInformationMessage(`Mallard: Data exported to ${saveUri.fsPath}`);
  });

  reg('mallard.prepareUninstall', async () => {
    const ok = await vscode.window.showWarningMessage(
      'This will delete all Mallard data (events, settings, cached pricing). This cannot be undone.',
      { modal: true },
      'Delete everything',
    );
    if (ok !== 'Delete everything') return;
    await store.clear();
    await userConfig.reset();
    await layout.reset();
    await pricing.clearCache();
    await restriction.clearAll();
    for (const key of context.globalState.keys()) {
      await context.globalState.update(key, undefined);
    }
    const targetSlots = exportTargetSlots(userConfig.get().export);
    for (const secretKey of [...ALL_SECRET_KEYS, ...targetSlots.map((s) => s.key)]) {
      await context.secrets.delete(secretKey);
    }
    void vscode.window.showInformationMessage(
      'All Mallard data cleared. You can now uninstall via the Extensions view.',
    );
  });

  reg('mallard.disableExtension', async () => {
    const ok = await vscode.window.showWarningMessage(
      'Disable Mallard? It stops running until you re-enable it from the Extensions view. ' +
        'Your local data is kept.',
      { modal: true },
      'Continue',
    );
    if (ok !== 'Continue') return;
    await vscode.commands.executeCommand('workbench.extensions.search', '@id:RedPandaMC.mallard');
    void vscode.window.showInformationMessage('Mallard: Click "Disable" next to Mallard above.');
  });

  const slotByKey = (key: string) => CREDENTIAL_SLOTS.find((s) => s.key === key)!;
  reg('mallard.manageCredentials', () =>
    manageCredentials(context.secrets, exportTargetSlots(userConfig.get().export)));
  reg('mallard.setMqttPassword', () =>
    promptAndStoreSecret(context.secrets, slotByKey(SECRET_KEYS.mqttPassword)));
  reg('mallard.setWebhookApiKey', () =>
    promptAndStoreSecret(context.secrets, slotByKey(SECRET_KEYS.webhookApiKey)));
  reg('mallard.setWebhookBearerToken', () =>
    promptAndStoreSecret(context.secrets, slotByKey(SECRET_KEYS.webhookBearerToken)));
  reg('mallard.setWebhookSigningSecret', () =>
    promptAndStoreSecret(context.secrets, slotByKey(SECRET_KEYS.webhookSigningSecret)));
  reg('mallard.setGitHubPat', () =>
    promptAndStoreSecret(context.secrets, slotByKey(SECRET_KEYS.githubPat)));
}
