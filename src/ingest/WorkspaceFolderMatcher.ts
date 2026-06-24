import * as vscode from 'vscode';

export interface IWorkspaceFolderMatcher {
  resolve(sessionId: string): string | undefined;
}

export class WorkspaceFolderMatcher implements IWorkspaceFolderMatcher {
  constructor(
    private readonly getFolders: () => ReadonlyArray<vscode.WorkspaceFolder> | undefined,
  ) {}

  resolve(sessionId: string): string | undefined {
    const folders = this.getFolders();
    if (!folders) return undefined;
    const needle = sessionId.toLowerCase();
    return folders.find((wf) => {
      const hash = encodeURIComponent(wf.uri.fsPath).replace(/%/g, '').toLowerCase();
      return hash === needle;
    })?.name;
  }
}
