/**
 * Multi-repo attribution. Maps a file URI to its workspace folder and git
 * remote slug (via the built-in Git extension API) so usage events can be
 * tagged per-repo — and aggregated/filtered across every folder in a
 * multi-root `.code-workspace`.
 */
import * as vscode from 'vscode';

interface GitRemote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}
interface GitRepository {
  rootUri: vscode.Uri;
  state: { remotes: GitRemote[] };
}
interface GitAPI {
  repositories: GitRepository[];
  getRepository(uri: vscode.Uri): GitRepository | null;
}

let gitApi: GitAPI | undefined;

/** Activate the built-in Git extension and cache its API. Safe to call once at startup. */
export async function initRepoAttribution(): Promise<void> {
  try {
    const ext = vscode.extensions.getExtension<{ getAPI(v: number): GitAPI }>('vscode.git');
    if (!ext) return;
    const exports = ext.isActive ? ext.exports : await ext.activate();
    gitApi = exports?.getAPI?.(1);
  } catch {
    // Git extension unavailable — fall back to folder names only.
  }
}

function slugFromRemote(url?: string): string | undefined {
  if (!url) return undefined;
  const m = /[/:]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? m[1] : undefined;
}

export interface RepoAttribution {
  repo?: string;
  workspaceFolder?: string;
}

export function attribute(uri: vscode.Uri | undefined): RepoAttribution {
  const folder = uri
    ? vscode.workspace.getWorkspaceFolder(uri)
    : vscode.workspace.workspaceFolders?.[0];
  const workspaceFolder = folder?.name;

  let repo: string | undefined;
  if (gitApi && uri) {
    const r = gitApi.getRepository(uri);
    const remote = r?.state.remotes[0];
    repo = slugFromRemote(remote?.fetchUrl ?? remote?.pushUrl);
  }

  return { repo: repo ?? workspaceFolder, workspaceFolder };
}

/** Attribution for the currently active editor (fallback: first workspace folder). */
export function activeAttribution(): RepoAttribution {
  const uri =
    vscode.window.activeTextEditor?.document.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  return attribute(uri);
}
