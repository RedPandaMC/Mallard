/* c8 ignore start */
/**
 * Pure scope data and custom-extension fallback. The host-side resolver in
 * `engine.ts` handles the `vscode.extensions.all` filter; this module just
 * names the scopes and the fallback for the `custom` value.
 */
import { RestrictionScope } from '../types';
/* c8 ignore stop */

const SCOPES: Record<RestrictionScope, string[]> = {
  copilot: ['github.copilot', 'github.copilot-chat'],
  'copilot+lab': [
    'github.copilot',
    'github.copilot-chat',
    'github.copilot-labs',
    'github.copilot-nightly',
  ],
  custom: [],
};

/** All known scope names. */
export function knownScopeNames(): RestrictionScope[] {
  return Object.keys(SCOPES) as RestrictionScope[];
}

/** Expand a scope name to its extension id list. `custom` returns []. */
export function scopeIds(scope: string): string[] {
  const key = (scope as RestrictionScope) in SCOPES ? (scope as RestrictionScope) : 'copilot';
  return SCOPES[key]!.slice();
}

/** Use the `custom` extension list when scope is `custom`. */
/* c8 ignore next */
export function customIdsFor(scope: string, customIds: string[]): string[] {
  return scope === 'custom' ? customIds : [];
}
