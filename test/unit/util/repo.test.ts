import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  activeBranch,
  attribute,
  branchForFolder,
  initRepoAttribution,
  listWorktrees,
  repoForFolder,
} from '../../../src/extension-backend/util/repo';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const ext = vscode.extensions as Mutable<typeof vscode.extensions>;
const ws = vscode.workspace as Mutable<typeof vscode.workspace>;
const win = vscode.window as Mutable<typeof vscode.window>;

function fakeGitApi(overrides: Record<string, unknown> = {}) {
  const repo = {
    rootUri: vscode.Uri.file('/work/mallard'),
    state: {
      remotes: [{ name: 'origin', fetchUrl: 'git@github.com:RedPandaMC/Mallard.git' }],
      HEAD: { name: 'feature/refinement' },
    },
  };
  return {
    repositories: [repo],
    getRepository: () => repo,
    ...overrides,
  };
}

/** Point the module's cached git API at a fake by re-running init. */
async function installGitApi(api: unknown): Promise<void> {
  ext.getExtension = ((id: string) =>
    id === 'vscode.git'
      ? { isActive: true, exports: { getAPI: () => api } }
      : undefined) as typeof ext.getExtension;
  await initRepoAttribution();
}

describe('util/repo — attribution', () => {
  const originalGetExtension = ext.getExtension;
  const originalFolders = ws.workspaceFolders;
  const originalGetFolder = ws.getWorkspaceFolder;
  const originalEditor = win.activeTextEditor;

  afterEach(async () => {
    ext.getExtension = originalGetExtension;
    ws.workspaceFolders = originalFolders;
    ws.getWorkspaceFolder = originalGetFolder;
    win.activeTextEditor = originalEditor;
    // Reset the module-level cache to "no git API".
    ext.getExtension = (() => undefined) as typeof ext.getExtension;
    await initRepoAttribution();
    ext.getExtension = originalGetExtension;
  });

  it('derives the repo slug from the git remote (ssh and https forms)', async () => {
    await installGitApi(fakeGitApi());
    const folder = { uri: vscode.Uri.file('/work/mallard'), name: 'mallard', index: 0 };
    ws.getWorkspaceFolder = (() => folder) as typeof ws.getWorkspaceFolder;

    const a = attribute(vscode.Uri.file('/work/mallard/src/x.ts'));
    assert.equal(a.repo, 'RedPandaMC/Mallard');
    assert.equal(a.workspaceFolder, 'mallard');
    assert.equal(repoForFolder(folder as vscode.WorkspaceFolder), 'RedPandaMC/Mallard');
  });

  it('falls back to the workspace folder name without a git remote', async () => {
    await installGitApi(
      fakeGitApi({ getRepository: () => ({ rootUri: vscode.Uri.file('/x'), state: { remotes: [] } }) }),
    );
    const folder = { uri: vscode.Uri.file('/work/plain'), name: 'plain', index: 0 };
    ws.getWorkspaceFolder = (() => folder) as typeof ws.getWorkspaceFolder;

    const a = attribute(vscode.Uri.file('/work/plain/readme.md'));
    assert.equal(a.repo, 'plain');
  });

  it('resolves nothing outside any workspace folder or git repo', async () => {
    ext.getExtension = (() => undefined) as typeof ext.getExtension;
    await initRepoAttribution();
    ws.getWorkspaceFolder = (() => undefined) as typeof ws.getWorkspaceFolder;
    ws.workspaceFolders = undefined;
    assert.deepEqual(attribute(undefined), {});
  });

  it('activeBranch prefers the active editor’s repository', async () => {
    await installGitApi(fakeGitApi());
    win.activeTextEditor = {
      document: { uri: vscode.Uri.file('/work/mallard/src/x.ts') },
    } as unknown as vscode.TextEditor;
    assert.equal(activeBranch(), 'feature/refinement');
  });

  it('activeBranch falls back to the first repository without an editor', async () => {
    await installGitApi(fakeGitApi({ getRepository: () => null }));
    win.activeTextEditor = undefined;
    assert.equal(activeBranch(), 'feature/refinement');
  });

  it('branchForFolder reads HEAD for a specific folder', async () => {
    await installGitApi(fakeGitApi());
    const folder = { uri: vscode.Uri.file('/work/mallard'), name: 'mallard', index: 0 };
    assert.equal(branchForFolder(folder as vscode.WorkspaceFolder), 'feature/refinement');
  });
});

describe('util/repo — listWorktrees', () => {
  it('returns [] for a directory that is not a git repository', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mallard-notrepo-'));
    assert.deepEqual(await listWorktrees(dir), []);
  });

  it('parses `git worktree list --porcelain` for a real repository', async function () {
    this.timeout(20_000);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mallard-repo-'));
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
    git('init', '-b', 'main');
    await fs.writeFile(path.join(dir, 'a.txt'), 'x');
    git('add', '.');
    git('commit', '-m', 'init');

    const worktrees = await listWorktrees(dir);
    assert.equal(worktrees.length, 1);
    assert.equal(worktrees[0]!.branch, 'main');
    assert.match(worktrees[0]!.head, /^[0-9a-f]{40}$/);
  });
});
