import * as vscode from 'vscode';

/** Thin wrapper around VS Code's GitHub auth that fires onDidChange on session transitions. */
export class GitHubSession implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange: vscode.Event<void> = this._onDidChange.event;
  private readonly _sub: vscode.Disposable;

  constructor() {
    this._sub = vscode.authentication.onDidChangeSessions((e) => {
      if (e.provider.id === 'github') this._onDidChange.fire();
    });
  }

  /**
   * Returns the current GitHub session, or undefined if not signed in.
   * Pass createIfNone=true to trigger a sign-in prompt.
   */
  async get(createIfNone: boolean): Promise<vscode.AuthenticationSession | undefined> {
    try {
      return await vscode.authentication.getSession('github', ['read:user'], {
        createIfNone,
        silent: !createIfNone,
      });
    } catch {
      return undefined;
    }
  }

  async getUsername(): Promise<string | undefined> {
    const s = await this.get(false);
    return s?.account.label;
  }

  dispose(): void {
    this._onDidChange.dispose();
    this._sub.dispose();
  }
}
