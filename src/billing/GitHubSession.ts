import * as vscode from 'vscode';
import type { GitHubBillingConfig } from '../domain/types';

/** Thin wrapper around VS Code's GitHub auth that fires onDidChange on session transitions. */
export class GitHubSession implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange: vscode.Event<void> = this._onDidChange.event;
  private readonly _sub: vscode.Disposable;

  /** Optional PAT config injected at construction or via configure(). */
  private billingConfig: GitHubBillingConfig | undefined;

  constructor() {
    this._sub = vscode.authentication.onDidChangeSessions((e) => {
      if (e.provider.id === 'github') this._onDidChange.fire();
    });
  }

  /** Update billing config (called when config.json changes). Invalidates cache. */
  configure(cfg: GitHubBillingConfig | undefined): void {
    this.billingConfig = cfg;
    this._onDidChange.fire();
  }

  /**
   * Returns the current GitHub session, or undefined if not signed in.
   * Pass createIfNone=true to trigger a sign-in prompt.
   */
  async get(createIfNone: boolean): Promise<vscode.AuthenticationSession | undefined> {
    if (this.billingConfig?.mode === 'pat') return undefined; // PAT mode bypasses session
    try {
      return await vscode.authentication.getSession('github', ['read:user'], {
        createIfNone,
        silent: !createIfNone,
      });
    } catch {
      return undefined;
    }
  }

  /**
   * Returns a Bearer token. Prefers PAT when configured; falls back to
   * VS Code session. Returns undefined when neither is available.
   */
  async getToken(createIfNone = false): Promise<{ token: string; username?: string } | undefined> {
    const pat = this.billingConfig?.pat?.trim();
    if (pat) return { token: pat };
    const session = await this.get(createIfNone);
    if (!session) return undefined;
    return { token: session.accessToken, username: session.account.label };
  }

  async getUsername(): Promise<string | undefined> {
    const auth = await this.getToken(false);
    if (!auth?.username) {
      // PAT mode: no username from session — org config is the alternative
      return this.billingConfig?.org ? undefined : undefined;
    }
    return auth.username;
  }

  /** The org slug configured for org-level billing, if any. */
  get org(): string | undefined {
    return this.billingConfig?.org?.trim() || undefined;
  }

  dispose(): void {
    this._onDidChange.dispose();
    this._sub.dispose();
  }
}
