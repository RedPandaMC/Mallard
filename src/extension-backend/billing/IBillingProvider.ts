import * as vscode from 'vscode';
import { ResultAsync } from 'neverthrow';
import { GitHubBillingData } from '../domain/types';

export interface IAuthProvider extends vscode.Disposable {
  /**
   * Get a bearer token.
   * scope = workspace folder → reads workspace-scoped PAT from VS Code settings
   * first, falls back to user-level PAT, then VS Code OAuth session.
   */
  getToken(
    createIfNone?: boolean,
    scope?: vscode.WorkspaceFolder,
  ): Promise<{ token: string; username?: string } | undefined>;

  /** Org slug resolved for the given scope, or undefined. */
  getOrg(scope?: vscode.WorkspaceFolder): string | undefined;

  readonly onDidChange: vscode.Event<void>;
}

export interface IBillingProvider extends vscode.Disposable {
  /** Human-readable name for diagnostics (e.g. "GitHub user billing"). */
  readonly name: string;

  /**
   * Fires when the underlying auth state changes and cached data was invalidated.
   * Callers should re-fetch after receiving this event.
   */
  readonly onDidChange: vscode.Event<void>;

  /**
   * Fetch billing data.
   * scope = workspace folder → org billing for that workspace's configured org.
   */
  fetch(scope?: vscode.WorkspaceFolder): ResultAsync<GitHubBillingData, Error>;

  /** Trigger an interactive sign-in flow. No-op for providers that don't need auth. */
  signIn?(): Promise<void>;
}
