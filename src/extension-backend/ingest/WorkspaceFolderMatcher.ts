/* c8 ignore next */
import * as vscode from 'vscode';

export interface IWorkspaceFolderMatcher {
  /** Resolve a session's working directory to the name of the workspace folder
   *  that contains it, or undefined when none does. */
  resolve(cwd: string): string | undefined;
}

/** Normalise a filesystem path for comparison: forward slashes, no trailing
 *  separator, lower-cased (case-insensitive match is fine for attribution). */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export class WorkspaceFolderMatcher implements IWorkspaceFolderMatcher {
  constructor(
    private readonly getFolders: () => ReadonlyArray<vscode.WorkspaceFolder> | undefined,
  ) {}

  resolve(cwd: string): string | undefined {
    const folders = this.getFolders();
    if (!folders || !cwd) return undefined;
    const target = normPath(cwd);

    // Claude Code records the session's `cwd` per line. Match it against each
    // workspace folder's path and pick the most specific (longest) folder that
    // contains the cwd — the correct behaviour for multi-root workspaces and
    // nested folders. (The previous implementation compared the random session
    // UUID against a hash of the folder path, which never matched real data.)
    let best: { name: string; len: number } | undefined;
    for (const wf of folders) {
      const base = normPath(wf.uri.fsPath);
      if (target === base || target.startsWith(`${base}/`)) {
        if (!best || base.length > best.len) best = { name: wf.name, len: base.length };
      }
    }
    return best?.name;
  }
  /* c8 ignore next */
}
