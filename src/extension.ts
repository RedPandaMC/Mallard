import * as vscode from 'vscode';
import { readConfig, RELEVANT_CONFIG_KEYS } from './config';
import { GitHubSession } from './auth/GitHubSession';
import { GitHubUsageService } from './data/GitHubUsageService';
import { LogWatcher } from './data/LogWatcher';
import { PricingService } from './data/PricingService';
import { EventStore } from './data/store/EventStore';
import { UsageService } from './data/UsageService';
import { DashboardPanel } from './ui/DashboardPanel';
import { SidebarViewProvider } from './ui/SidebarViewProvider';
import { StatusBarController } from './ui/StatusBarController';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Load the bundled pricing manifest.
  const bundledManifestPath = vscode.Uri.joinPath(
    context.extensionUri,
    'media',
    'pricing-manifest.json',
  ).fsPath;
  const bundledManifest = await (async () => {
    try {
      const raw = await vscode.workspace.fs.readFile(
        vscode.Uri.file(bundledManifestPath),
      );
      return JSON.parse(Buffer.from(raw).toString('utf8'));
    } catch {
      return { version: 1, pricePerCredit: 0.04, updatedAt: '', models: {} };
    }
  })();

  const cfg = readConfig();
  const storageDir = context.globalStorageUri.fsPath;
  const pricing = new PricingService(storageDir, bundledManifest, cfg.pricingManifestUrl || '');
  await pricing.load();
  pricing.startDailyRefresh();

  const store = new EventStore(storageDir);
  const logUriPath = context.logUri?.fsPath;
  const watcher = new LogWatcher(
    store,
    pricing,
    logUriPath,
    cfg.copilotLogPath || undefined,
  );

  const githubSession = new GitHubSession();
  const github = new GitHubUsageService(githubSession);
  const usage = new UsageService(store, pricing, watcher, github);
  const statusBar = new StatusBarController();

  context.subscriptions.push(
    { dispose: () => pricing.dispose() },
    { dispose: () => githubSession.dispose() },
    usage,
    statusBar,
    usage.onDidChangeSnapshot((s) => statusBar.update(s)),
  );

  const sidebar = new SidebarViewProvider(context, usage);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebar),
  );

  registerCommands(context, usage, store);

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

function registerCommands(
  context: vscode.ExtensionContext,
  usage: UsageService,
  store: EventStore,
): void {
  const reg = (id: string, fn: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('weevil.openDashboard', () => DashboardPanel.show(context, usage));

  reg('weevil.refresh', async () => {
    await usage.refresh();
  });

  reg('weevil.clearData', async () => {
    const ok = await vscode.window.showWarningMessage(
      'Clear all recorded Weevil usage data? This cannot be undone.',
      { modal: true },
      'Clear',
    );
    if (ok === 'Clear') {
      await store.clear();
      await usage.refresh();
    }
  });

  reg('weevil.signIn', async () => {
    await usage.signInGitHub();
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
