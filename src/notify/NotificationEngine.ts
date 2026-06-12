/**
 * Turns evaluated rule alerts into debounced, non-modal notifications. Each
 * rule fires at most once per cool-down window to avoid spam.
 */
import * as vscode from 'vscode';
import { readConfig } from '../config';
import { UsageService } from '../data/UsageService';
import { Alert, evaluateRules } from './rules';

const COOLDOWN_MS = 60 * 60 * 1000; // one hour per rule

export class NotificationEngine implements vscode.Disposable {
  private readonly lastFired = new Map<string, number>();
  private readonly sub: vscode.Disposable;

  constructor(private readonly usage: UsageService) {
    this.sub = usage.onDidChangeSnapshot(() => this.evaluate());
  }

  private evaluate(): void {
    const cfg = readConfig();
    if (!cfg.notifications?.length) return;
    const snapshot = this.usage.current;
    if (!snapshot) return;

    const now = Date.now();
    const alerts = evaluateRules([...this.usage.events], cfg.notifications, now, snapshot.currency);
    for (const alert of alerts) {
      const last = this.lastFired.get(alert.ruleId) ?? 0;
      if (now - last < COOLDOWN_MS) continue;
      this.lastFired.set(alert.ruleId, now);
      if (alert.channel === 'toast') void this.showToast(alert);
    }
  }

  private async showToast(alert: Alert): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      alert.message,
      'Open dashboard',
      'Configure',
      'Snooze',
    );
    if (choice === 'Open dashboard') {
      void vscode.commands.executeCommand('weevil.openDashboard');
    } else if (choice === 'Configure') {
      void vscode.commands.executeCommand('weevil.configureNotifications');
    }
  }

  dispose(): void {
    this.sub.dispose();
  }
}
