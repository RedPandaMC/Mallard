/**
 * Host-side adapter over the pure scope logic in `scopes.ts`. Filters the
 * extension id list against `vscode.extensions.all` so we never try to
 * disable an extension that isn't installed.
 */
import * as vscode from 'vscode';
import { customIdsFor, scopeIds } from './scopes';

export async function resolveScopeIds(scope: string, customIds: string[]): Promise<string[]> {
  const ids = [...scopeIds(scope), ...customIdsFor(scope, customIds)];
  const installed = new Set<string>(vscode.extensions.all.map((e) => e.id));
  return ids.filter((id) => installed.has(id));
}
