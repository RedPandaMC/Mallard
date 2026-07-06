import { strict as assert } from 'assert';
import { GitHubUsageService } from '../../../src/extension-backend/billing/GitHubUsageService';
import type { IAuthProvider } from '../../../src/extension-backend/billing/IBillingProvider';

type Listener = () => void;

function makeSession(over: Partial<IAuthProvider> = {}): IAuthProvider & { fireChange(): void } {
  const listeners: Listener[] = [];
  return {
    getToken: async () => ({ token: 'tok', username: 'octocat' }),
    getOrg: () => undefined,
    onDidChange: (l: Listener) => {
      listeners.push(l);
      return { dispose() {} };
    },
    fireChange: () => listeners.forEach((l) => l()),
    ...over,
  } as IAuthProvider & { fireChange(): void };
}

const QUOTA_RESPONSE = {
  copilot_plan: 'copilot_pro',
  quota_snapshots: {
    premium_interactions: { entitlement: 300, percent_remaining: 75, unlimited: false },
  },
  quota_reset_date: '2026-08-01',
};

const BILLING_RESPONSE = {
  usageItems: [
    { model: 'claude-sonnet-4-5', sku: 'premium', grossQuantity: 100, grossAmount: 4.0, netAmount: 3.5 },
    { grossAmount: 1.0, netAmount: 1.0 },
  ],
};

function stubFetch(routes: Record<string, unknown | number>) {
  const requests: string[] = [];
  globalThis.fetch = (async (url: unknown) => {
    const u = String(url);
    requests.push(u);
    for (const [needle, response] of Object.entries(routes)) {
      if (u.includes(needle)) {
        if (typeof response === 'number') return { ok: false, status: response } as Response;
        return { ok: true, status: 200, json: async () => response } as Response;
      }
    }
    return { ok: false, status: 404 } as Response;
  }) as typeof fetch;
  return requests;
}

describe('GitHubUsageService', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('fetches quota + user billing and parses both', async () => {
    const requests = stubFetch({
      copilot_internal: QUOTA_RESPONSE,
      '/users/octocat/': BILLING_RESPONSE,
    });
    const svc = new GitHubUsageService(makeSession());
    const result = await svc.fetch();
    assert.ok(result.isOk());
    const data = result._unsafeUnwrap();

    // percent_remaining is 0-100: 300 × (1 − 75/100) = 75 used
    assert.equal(data.quota!.used, 75);
    assert.equal(data.quota!.entitlement, 300);
    assert.equal(data.quota!.plan, 'copilot_pro');
    assert.equal(data.quota!.unlimited, false);

    assert.equal(data.items.length, 2);
    assert.equal(data.items[0]!.model, 'claude-sonnet-4-5');
    assert.equal(data.items[1]!.model, 'unknown'); // defaults applied
    assert.ok(Math.abs(data.totalNetAmount - 4.5) < 1e-9);
    assert.ok(requests.some((u) => u.includes('/users/octocat/settings/billing/ai_credit/usage')));
    svc.dispose();
  });

  it('uses the org billing endpoint when the session resolves an org', async () => {
    const requests = stubFetch({ copilot_internal: QUOTA_RESPONSE, '/orgs/acme/': BILLING_RESPONSE });
    const svc = new GitHubUsageService(makeSession({ getOrg: () => 'acme' }));
    const result = await svc.fetch();
    assert.ok(result.isOk());
    assert.ok(requests.some((u) => u.includes('/orgs/acme/settings/billing/ai_credit/usage')));
    assert.ok(!requests.some((u) => u.includes('/users/')));
    svc.dispose();
  });

  it('errs with "Not signed in" when no token is available', async () => {
    stubFetch({});
    const svc = new GitHubUsageService(makeSession({ getToken: async () => undefined }));
    const result = await svc.fetch();
    assert.ok(result.isErr());
    assert.match(result._unsafeUnwrapErr().message, /Not signed in/);
    svc.dispose();
  });

  it('degrades gracefully when both endpoints fail (null quota, empty items)', async () => {
    // Immediate 404s → fetchJson throws → .catch(() => null) — no retry delay for 4xx?
    // p-retry retries all failures; use routes that resolve OK with junk instead
    // to keep the test fast while still exercising the parse guards.
    stubFetch({ copilot_internal: { nonsense: true }, '/users/octocat/': 'not-an-object' });
    const svc = new GitHubUsageService(makeSession());
    const result = await svc.fetch();
    assert.ok(result.isOk());
    const data = result._unsafeUnwrap();
    assert.equal(data.quota, null);
    assert.deepEqual(data.items, []);
    assert.equal(data.totalNetAmount, 0);
    svc.dispose();
  });

  it('caches per scope for the TTL — a second fetch makes no new requests', async () => {
    const requests = stubFetch({
      copilot_internal: QUOTA_RESPONSE,
      '/users/octocat/': BILLING_RESPONSE,
    });
    const svc = new GitHubUsageService(makeSession());
    await svc.fetch();
    const after = requests.length;
    await svc.fetch();
    assert.equal(requests.length, after, 'cached fetch must not hit the network');
    svc.dispose();
  });

  it('clears the cache and refires when the session changes', async () => {
    const requests = stubFetch({
      copilot_internal: QUOTA_RESPONSE,
      '/users/octocat/': BILLING_RESPONSE,
    });
    const session = makeSession();
    const svc = new GitHubUsageService(session);
    let changed = 0;
    svc.onDidChange(() => changed++);

    await svc.fetch();
    const before = requests.length;
    session.fireChange();
    assert.equal(changed, 1);
    await svc.fetch();
    assert.ok(requests.length > before, 'session change must invalidate the cache');
    svc.dispose();
  });

  it('signIn asks the session for an interactive token', async () => {
    let interactive: boolean | undefined;
    const svc = new GitHubUsageService(
      makeSession({
        getToken: async (createIfNone?: boolean) => {
          interactive = createIfNone;
          return { token: 't' };
        },
      }),
    );
    await svc.signIn();
    assert.equal(interactive, true);
    svc.dispose();
  });

  it('needsPat delegates to the session', async () => {
    const svc = new GitHubUsageService(makeSession({ needsPat: async () => true }));
    assert.equal(await svc.needsPat(), true);
    svc.dispose();
  });

  it('skips the billing endpoint when neither org nor username is available', async () => {
    const requests = stubFetch({ copilot_internal: QUOTA_RESPONSE });
    const svc = new GitHubUsageService(
      makeSession({ getToken: async () => ({ token: 't' }), getOrg: () => undefined }),
    );
    const result = await svc.fetch();
    assert.ok(result.isOk());
    const data = result._unsafeUnwrap();
    assert.ok(data.items.length === 0, 'no billing items when no org/username');
    assert.equal(
      requests.some((u) => u.includes('settings/billing')),
      false,
      'no billing request made',
    );
    svc.dispose();
  });
});
