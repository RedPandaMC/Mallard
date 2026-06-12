import * as vscode from 'vscode';
import { GitHubAuth } from './auth/GitHubAuth';
import { ChatCapture } from './capture/ChatCapture';
import { registerChatParticipant } from './chat/participant';
import { readConfig, RELEVANT_CONFIG_KEYS } from './config';
import { UsageService } from './data/UsageService';
import { EventStore } from './data/store/EventStore';
import { formatCredits, formatMoney, formatTokens } from './model/format';
import { NotificationEngine } from './notify/NotificationEngine';
import { pickTip } from './tips/tips';
import { DashboardPanel } from './ui/DashboardPanel';
import { SidebarViewProvider } from './ui/SidebarViewProvider';
import { StatusBarController } from './ui/StatusBarController';
import { initRepoAttribution } from './util/repo';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const store = new EventStore(context.globalStorageUri.fsPath);
  const auth = new GitHubAuth(context);
  const usage = new UsageService(store, () => auth.getToken());
  const statusBar = new StatusBarController();
  const notifications = new NotificationEngine(usage);
  const capture = new ChatCapture(usage);

  context.subscriptions.push(auth, usage, statusBar, notifications);
  context.subscriptions.push(usage.onDidChangeSnapshot((s) => statusBar.update(s)));

  const sidebar = new SidebarViewProvider(context, usage);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebar),
  );

  context.subscriptions.push(registerChatParticipant(context, usage, capture));

  registerCommands(context, usage, auth, store);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (RELEVANT_CONFIG_KEYS.some((k) => e.affectsConfiguration(k))) usage.onConfigChanged();
    }),
    auth.onDidChange(() => void usage.refresh()),
  );

  await initRepoAttribution();
  await auth.init();
  await usage.start();
}

export function deactivate(): void {
  // disposables are cleaned up via context.subscriptions
}

function registerCommands(
  context: vscode.ExtensionContext,
  usage: UsageService,
  auth: GitHubAuth,
  store: EventStore,
): void {
  const reg = (id: string, fn: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  const config = () => vscode.workspace.getConfiguration('weevil');

  reg('weevil.openDashboard', () => DashboardPanel.show(context, usage));
  reg('weevil.refresh', () => usage.refresh());
  reg('weevil.showBreakdown', () => showBreakdown(usage));

  reg('weevil.setScope', async () => {
    const pick = await vscode.window.showQuickPick(['session', 'today', 'workspace', 'repo'], {
      placeHolder: 'What should the status bar reflect?',
    });
    if (pick) await config().update('statusBar.scope', pick, vscode.ConfigurationTarget.Global);
  });

  reg('weevil.setBudget', async () => {
    const current = readConfig().monthlyBudget;
    const input = await vscode.window.showInputBox({
      prompt: 'Monthly Copilot budget (0 = none)',
      value: String(current),
      validateInput: (v) => (Number.isNaN(Number(v)) ? 'Enter a number' : undefined),
    });
    if (input != null) {
      await config().update('monthlyBudget', Number(input), vscode.ConfigurationTarget.Global);
    }
  });

  reg('weevil.configureNotifications', () =>
    vscode.commands.executeCommand('workbench.action.openSettings', 'weevil.notifications'),
  );

  reg('weevil.signIn', async () => {
    if (await auth.signIn()) await usage.refresh();
  });
  reg('weevil.signOut', async () => {
    await auth.signOut();
    await usage.refresh();
  });

  reg('weevil.exportData', async () => {
    const json = await store.export();
    const doc = await vscode.workspace.openTextDocument({ language: 'json', content: json });
    await vscode.window.showTextDocument(doc);
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

  reg('weevil.showTips', () => {
    const tip = pickTip(usage.current);
    void vscode.window.showInformationMessage(`Weevil tip — ${tip.title}: ${tip.body}`);
  });
}

async function showBreakdown(usage: UsageService): Promise<void> {
  const s = usage.current;
  if (!s) {
    void vscode.window.showInformationMessage('Weevil is still gathering your usage.');
    return;
  }
  const items: vscode.QuickPickItem[] = [
    {
      label: `$(calendar) ${s.current.label}`,
      detail: `${formatMoney(s.current.cost, s.currency)} · ${formatCredits(
        s.current.credits,
      )} cr · ${formatTokens(s.current.tokens)} tokens`,
    },
    {
      label: `$(graph) Projected month-end`,
      detail: formatMoney(s.forecast.projectedCost, s.currency),
    },
    ...s.topModels.map((m) => ({
      label: `$(symbol-method) ${m.key}`,
      detail: `${formatMoney(m.cost, s.currency)} · ${formatCredits(m.credits)} cr`,
    })),
    { label: '$(dashboard) Open full dashboard…', detail: 'Charts, filters and forecast' },
  ];
  const choice = await vscode.window.showQuickPick(items, {
    placeHolder: 'Weevil — Copilot spend breakdown',
  });
  if (choice?.label.includes('Open full dashboard')) {
    void vscode.commands.executeCommand('weevil.openDashboard');
  }
}
