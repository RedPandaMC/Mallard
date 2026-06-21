/**
 * Multi-repo attribution. Maps a file URI to its workspace folder and git
 * remote slug (via the built-in Git extension API) so usage events can be
 * tagged per-repo — and aggregated/filtered across every folder in a
 * multi-root `.code-workspace`.
 *
 * Worktrees: VS Code's Git extension exposes each worktree as a distinct
 * `GitRepository` in `api.repositories`, so worktree-aware attribution works
 * automatically via `api.getRepository(uri)` on the active editor's file URI.
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';

interface GitRemote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}
interface GitRepository {
  rootUri: vscode.Uri;
  state: {
    remotes: GitRemote[];
    HEAD?: { name?: string };
  };
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
  const remoteMatch = /[/:]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return remoteMatch ? remoteMatch[1] : undefined;
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

  const resolvedRepo = repo ?? workspaceFolder;
  return {
    ...(resolvedRepo !== undefined ? { repo: resolvedRepo } : {}),
    ...(workspaceFolder !== undefined ? { workspaceFolder } : {}),
  };
}

/** Attribution for the currently active editor (fallback: first workspace folder). */
export function activeAttribution(): RepoAttribution {
  const uri =
    vscode.window.activeTextEditor?.document.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  return attribute(uri);
}

/** Repo slug for a specific workspace folder (git remote slug or folder name). */
export function repoForFolder(folder: vscode.WorkspaceFolder): string | undefined {
  return attribute(folder.uri).repo;
}

/** HEAD branch name for a specific workspace folder's git repository. */
export function branchForFolder(folder: vscode.WorkspaceFolder): string | undefined {
  if (gitApi) {
    const repo = gitApi.getRepository(folder.uri);
    if (repo?.state.HEAD?.name) return repo.state.HEAD.name;
  }
  return undefined;
}

/**
 * Name of the HEAD branch in the repository containing the active editor file.
 * Falls back to the first known repository when no editor is active.
 *
 * Using the active editor's repository (rather than `repositories[0]`) means
 * this works correctly in worktree setups where different editor files live in
 * different worktree paths, each with a distinct branch.
 */
export function activeBranch(): string | undefined {
  const uri = vscode.window.activeTextEditor?.document.uri;
  if (uri && gitApi) {
    const repo = gitApi.getRepository(uri);
    if (repo?.state.HEAD?.name) return repo.state.HEAD.name;
  }
  return gitApi?.repositories[0]?.state.HEAD?.name;
}

/** A single git worktree entry from `git worktree list --porcelain`. */
export interface WorktreeInfo {
  /** Absolute path to the worktree's working directory. */
  path: string;
  /** The branch checked out in this worktree (undefined for detached HEAD). */
  branch?: string;
  /** Full commit SHA. */
  head: string;
}

/**
 * List all worktrees for the repository rooted at `repoPath` using
 * `git worktree list --porcelain`. Returns an empty array on error (git not
 * available, path not a git repo, etc.).
 */
export function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  return new Promise((resolve) => {
    execFile('git', ['worktree', 'list', '--porcelain'], { cwd: repoPath }, (err, stdout) => {
      if (err) { resolve([]); return; }
      const worktrees: WorktreeInfo[] = [];
      let current: Partial<WorktreeInfo> | null = null;
      for (const line of stdout.split('\n')) {
        if (line.startsWith('worktree ')) {
          if (current?.path && current.head) worktrees.push(current as WorktreeInfo);
          current = { path: line.slice('worktree '.length).trim() };
        } else if (line.startsWith('HEAD ') && current) {
          current.head = line.slice('HEAD '.length).trim();
        } else if (line.startsWith('branch refs/heads/') && current) {
          current.branch = line.slice('branch refs/heads/'.length).trim();
        }
      }
      if (current?.path && current.head) worktrees.push(current as WorktreeInfo);
      resolve(worktrees);
    });
  });
}
