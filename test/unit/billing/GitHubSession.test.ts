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

describe('GitHubSession — onDidChangeSession listener', () => {
  let sessionListener: ((e: { provider: { id: string } }) => void) | undefined;
  const auth2 = vscode.authentication as Mutable<typeof vscode.authentication>;
  const origOnChanged = auth2.onDidChangeSessions;

  beforeEach(() => {
    sessionListener = undefined;
    auth2.onDidChangeSessions = ((fn: (e: { provider: { id: string } }) => void) => {
      sessionListener = fn;
      return { dispose() {} };
    }) as unknown as typeof auth2.onDidChangeSessions;
  });
  afterEach(() => { auth2.onDidChangeSessions = origOnChanged; });

  it('fires onDidChange only for the github provider', () => {
    const s = new GitHubSession(makeSecrets());
    let fired = 0;
    s.onDidChange(() => fired++);
    sessionListener!({ provider: { id: 'github' } });
    assert.equal(fired, 1);
    sessionListener!({ provider: { id: 'microsoft' } });
    assert.equal(fired, 1, 'non-github provider must not fire');
    s.dispose();
  });
});

describe('GitHubSession — getOrg()', () => {
  const ws = vscode.workspace as Mutable<typeof vscode.workspace>;
  const origGetConfig = ws.getConfiguration;
  afterEach(() => { ws.getConfiguration = origGetConfig; });

  it('returns the workspace-scoped org when a folder is given', () => {
    ws.getConfiguration = ((section: string, _scope?: unknown) => ({
      get: (key: string) => (section === 'mallard' && key === 'githubBilling.org' ? 'ws-org' : undefined),
      update: () => Promise.resolve(),
    })) as unknown as typeof ws.getConfiguration;
    const s = new GitHubSession(makeSecrets());
    s.configure({ mode: 'oauth', org: 'config-org' });
    assert.equal(s.getOrg({} as vscode.WorkspaceFolder), 'ws-org');
    s.dispose();
  });

  it('falls back to the config-level org when no scope or no ws setting', () => {
    ws.getConfiguration = (() => ({
      get: () => undefined,
      update: () => Promise.resolve(),
    })) as unknown as typeof ws.getConfiguration;
    const s = new GitHubSession(makeSecrets());
    s.configure({ mode: 'oauth', org: 'config-org' });
    assert.equal(s.getOrg(), 'config-org');
    assert.equal(s.getOrg({} as vscode.WorkspaceFolder), 'config-org');
    s.dispose();
  });

  it('returns undefined when no org is configured anywhere', () => {
    ws.getConfiguration = (() => ({
      get: () => undefined,
      update: () => Promise.resolve(),
    })) as unknown as typeof ws.getConfiguration;
    const s = new GitHubSession(makeSecrets());
    assert.equal(s.getOrg(), undefined);
    s.dispose();
  });
});

describe('GitHubSession — get() (session accessor)', () => {
  const auth3 = vscode.authentication as Mutable<typeof vscode.authentication>;
  const origGetSession = auth3.getSession;
  afterEach(() => { auth3.getSession = origGetSession; });

  it('returns undefined in pat mode (never creates an OAuth session)', async () => {
    auth3.getSession = (() => { throw new Error('must not be called'); }) as unknown as typeof auth3.getSession;
    const s = new GitHubSession(makeSecrets());
    s.configure({ mode: 'pat' });
    assert.equal(await s.get(true), undefined);
    s.dispose();
  });

  it('delegates to _getSession in oauth mode', async () => {
    const fakeSession = { accessToken: 't', account: { label: 'u' } } as unknown as vscode.AuthenticationSession;
    auth3.getSession = (() => Promise.resolve(fakeSession)) as unknown as typeof auth3.getSession;
    const s = new GitHubSession(makeSecrets());
    s.configure({ mode: 'oauth' });
    assert.equal(await s.get(false), fakeSession);
    s.dispose();
  });
});
