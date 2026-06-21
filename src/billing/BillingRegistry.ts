import * as vscode from 'vscode';
import { GitHubBillingData } from '../domain/types';
import { IBillingProvider } from './IBillingProvider';

export class BillingRegistry implements vscode.Disposable {
  private readonly providers: IBillingProvider[] = [];

  /** Register a billing provider. All registered providers are queried on fetchAll(). */
  register(provider: IBillingProvider): void {
    this.providers.push(provider);
  }

  /**
   * Fetch from all registered providers. Failed providers are silently omitted.
   * scope = workspace folder for workspace-scoped org billing.
   */
  async fetchAll(scope?: vscode.WorkspaceFolder): Promise<GitHubBillingData[]> {
    const results = await Promise.all(
      this.providers.map((p) =>
        p.fetch(scope).match(
          (d) => d,
          () => null,
        ),
      ),
    );
    return results.filter((d): d is GitHubBillingData => d !== null);
  }

  dispose(): void {
    for (const p of this.providers) p.dispose();
  }
}
