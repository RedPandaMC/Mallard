/**
 * Optional GitHub sign-in for calibration. Reuses VSCode's built-in GitHub
 * auth provider (one consent dialog, no separate password). The access token is
 * mirrored into SecretStorage (OS keychain) — never settings or globalState.
 */
import * as vscode from 'vscode';

const SECRET_KEY = 'weevil.github.token';
const SCOPES = ['read:user'];

export class GitHubAuth implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private signedIn = false;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.disposables.push(
      vscode.authentication.onDidChangeSessions((e) => {
        if (e.provider.id === 'github') void this.syncContext();
      }),
    );
  }

  async init(): Promise<void> {
    await this.syncContext();
  }

  isSignedIn(): boolean {
    return this.signedIn;
  }

  async getToken(): Promise<string | undefined> {
    return this.context.secrets.get(SECRET_KEY);
  }

  async signIn(): Promise<boolean> {
    const consent = await vscode.window.showInformationMessage(
      'Connect GitHub so Weevil can calibrate your local estimate against official usage. ' +
        'Weevil reads your GitHub identity only — the token stays in your OS keychain and nothing is sent elsewhere.',
      { modal: true },
      'Connect',
    );
    if (consent !== 'Connect') return false;

    try {
      const session = await vscode.authentication.getSession('github', SCOPES, {
        createIfNone: true,
      });
      if (session) {
        await this.context.secrets.store(SECRET_KEY, session.accessToken);
        await this.setSignedIn(true);
        return true;
      }
    } catch {
      void vscode.window.showErrorMessage('Weevil: GitHub sign-in failed.');
    }
    return false;
  }

  async signOut(): Promise<void> {
    await this.context.secrets.delete(SECRET_KEY);
    await this.setSignedIn(false);
    void vscode.window.showInformationMessage('Weevil: disconnected from GitHub.');
  }

  private async syncContext(): Promise<void> {
    let session: vscode.AuthenticationSession | undefined;
    try {
      session = await vscode.authentication.getSession('github', SCOPES, {
        createIfNone: false,
        silent: true,
      });
    } catch {
      session = undefined;
    }
    if (session) await this.context.secrets.store(SECRET_KEY, session.accessToken);
    await this.setSignedIn(!!session);
  }

  private async setSignedIn(value: boolean): Promise<void> {
    const changed = this.signedIn !== value;
    this.signedIn = value;
    await vscode.commands.executeCommand('setContext', 'weevil.signedIn', value);
    if (changed) this._onDidChange.fire();
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this._onDidChange.dispose();
  }
}
