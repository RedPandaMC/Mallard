/**
 * The always-on status bar item: credits + cost for today, tinted by spend pace.
 * Click opens the dashboard.
 */
import * as vscode from 'vscode';
import { severityFor } from '../domain/budget';
import { formatCredits, formatMoney } from '../domain/format';
import { UsageSnapshot } from '../domain/types';

export class StatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      'weevil.spend',
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.item.name = 'Weevil';
    this.item.command = 'weevil.openDashboard';
    this.item.text = '$(circle-filled) Weevil';
    this.item.tooltip = 'Weevil — loading usage…';
    this.item.show();
  }

  update(snapshot: UsageSnapshot): void {
    const { today, currency, budget } = snapshot;
    const cr = formatCredits(today.credits);
    const cost = formatMoney(today.cost, currency);
    this.item.text = `$(circle-filled) ${cr} cr · ${cost}`;
    this.item.tooltip = buildTooltip(snapshot);

    const severity = severityFor(budget);
    this.item.backgroundColor =
      severity === 'error'
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : severity === 'warning'
          ? new vscode.ThemeColor('statusBarItem.warningBackground')
          : undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}

function buildTooltip(s: UsageSnapshot): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`**Weevil** — Copilot usage tracker\n\n`);
  md.appendMarkdown(
    `- **Today:** ${formatMoney(s.today.cost, s.currency)} · ${formatCredits(s.today.credits)} cr\n`,
  );
  md.appendMarkdown(
    `- **Month-to-date:** ${formatMoney(s.budget.usedCost, s.currency)} · ${formatCredits(s.budget.usedCredits)} cr\n`,
  );
  if (s.forecast.basis !== 'insufficient-data') {
    md.appendMarkdown(
      `- **Projected:** ${formatMoney(s.forecast.projectedCost, s.currency)}\n`,
    );
  }
  if (s.topModels[0]) md.appendMarkdown(`- **Top model:** ${s.topModels[0].key}\n`);
  md.appendMarkdown(`\n_Click to open dashboard._`);
  return md;
}
