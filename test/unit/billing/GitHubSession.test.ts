import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import { GitHubSession } from '../../../src/extension-backend/billing/GitHubSession';
import { SECRET_KEYS } from '../../../src/extension-backend/app/credentials';

function makeSecrets(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store: async (k: string, v: string) => void store.set(k, v),
    get: async (k: string) => store.get(k),
    delete: async (k: string) => void store.delete(k),
    onDidChange: () => ({ dispose() {} }),
    _map: store,
  } as unknown as vscode.SecretStorage & { _map: Map<string, string> };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const auth = vscode.authentication as Mutable<typeof vscode.authentication>;

describe('GitHubSession — token resolution order', () => {
  const originalGetSession = auth.getSession;
  afterEach(() => { auth.getSession = originalGetSession; });

  it('1. SecretStorage PAT wins over the OAuth session', async () => {
    auth.getSession = (() => {
      throw new Error('must not be called when a PAT is stored');
    }) as unknown as typeof auth.getSession;
    const secrets = makeSecrets({ [SECRET_KEYS.githubPat]: 'stored-pat' });
    const s = new GitHubSession(secrets);
    assert.deepEqual(await s.getToken(), { token: 'stored-pat' });
    s.dispose();
  });

  it('2. mode "pat" uses only the stored PAT', async () => {
    const secrets = makeSecrets({ [SECRET_KEYS.githubPat]: 'stored-pat' });
    const s = new GitHubSession(secrets);
    s.configure({ mode: 'pat' });
    assert.deepEqual(await s.getToken(), { token: 'stored-pat' });
    s.dispose();
  });

  it('3. falls back to the VS Code OAuth session', async () => {
    auth.getSession = (() =>
      Promise.resolve({
        accessToken: 'oauth-token',
        account: { label: 'octocat' },
      })) as unknown as typeof auth.getSession;
    const s = new GitHubSession(makeSecrets());
    assert.deepEqual(await s.getToken(), { token: 'oauth-token', username: 'octocat' });
    s.dispose();
  });

  it('mode "pat" without any PAT yields undefined (never silently OAuths)', async () => {
    auth.getSession = (() => {
      throw new Error('must not be called in pat mode');
    }) as unknown as typeof auth.getSession;
    const s = new GitHubSession(makeSecrets());
    s.configure({ mode: 'pat' });
    assert.equal(await s.getToken(), undefined);
    s.dispose();
  });

  it('returns undefined when the OAuth prompt is dismissed', async () => {
    auth.getSession = (() => Promise.reject(new Error('cancelled'))) as unknown as typeof auth.getSession;
    const s = new GitHubSession(makeSecrets(), { debug() {}, info() {}, warn() {}, error() {} });
    assert.equal(await s.getToken(), undefined);
    s.dispose();
  });
});
