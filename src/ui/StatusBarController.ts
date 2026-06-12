/**
 * The always-on "circle + button": a tinted circular status-bar indicator that
 * opens the spend breakdown on click.
 */
import * as vscode from 'vscode';
import { readConfig } from '../config';
import { severityFor } from '../model/budget';
import { formatCredits, formatMetric, formatMoney } from '../model/format';
import { UsageSnapshot } from '../model/types';

export class StatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      'weevil.spend',
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.item.name = 'Weevil';
    this.item.command = 'weevil.showBreakdown';
    this.item.text = '$(circle-filled) Weevil';
    this.item.tooltip = 'Weevil — loading usage…';
    this.item.show();
  }

  update(snapshot: UsageSnapshot): void {
    const cfg = readConfig();
    const metric = cfg.statusBarMetric;
    const value =
      metric === 'cost'
        ? snapshot.current.cost
        : metric === 'credits'
          ? snapshot.current.credits
          : snapshot.current.tokens;

    this.item.text = `$(circle-filled) ${formatMetric(value, metric, snapshot.currency)}`;
    this.item.tooltip = buildTooltip(snapshot);

    const severity = severityFor(snapshot.budget);
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
  md.appendMarkdown(`**Weevil** — a little nosey about your Copilot spend\n\n`);
  md.appendMarkdown(
    `- **${s.current.label}:** ${formatMoney(s.current.cost, s.currency)} · ${formatCredits(
      s.current.credits,
    )} cr\n`,
  );
  md.appendMarkdown(
    `- **Projected month:** ${formatMoney(s.forecast.projectedCost, s.currency)}\n`,
  );
  if (s.budget.monthly) {
    md.appendMarkdown(`- **Budget:** ${formatMoney(s.budget.monthly, s.currency)} (${s.budget.pace})\n`);
  }
  if (s.topModels[0]) md.appendMarkdown(`- **Top model:** ${s.topModels[0].key}\n`);
  if (s.topRepos[0]) md.appendMarkdown(`- **Top repo:** ${s.topRepos[0].key}\n`);
  md.appendMarkdown(`\n_Click to open the breakdown._`);
  return md;
}
