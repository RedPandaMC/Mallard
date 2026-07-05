import * as vscode from 'vscode';

export interface VscodeHost {
  showWarningMessage(msg: string): Thenable<string | undefined>;
  executeCommand(command: string, ...args: unknown[]): Thenable<unknown>;
}

export const defaultVscodeHost: VscodeHost = {
  showWarningMessage: (msg) => vscode.window.showWarningMessage(msg),
  executeCommand: (cmd, ...args) => vscode.commands.executeCommand(cmd, ...args),
  /* c8 ignore next */
};
