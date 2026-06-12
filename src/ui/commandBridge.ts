import * as vscode from 'vscode';
import { CommandId } from './messaging';

const MAP: Record<CommandId, string> = {
  signIn: 'weevil.signIn',
  setBudget: 'weevil.setBudget',
  openDashboard: 'weevil.openDashboard',
  configureNotifications: 'weevil.configureNotifications',
};

/** Run a whitelisted command requested from a webview. */
export function runWebviewCommand(id: CommandId): void {
  const command = MAP[id];
  if (command) void vscode.commands.executeCommand(command);
}
