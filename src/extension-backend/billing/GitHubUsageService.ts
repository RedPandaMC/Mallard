/* c8 ignore next */
/**
 * Fetches authoritative Copilot usage data from the GitHub API.
 *
 * Two endpoints:
 *   - copilot_internal/user          → quota/plan info (no extra scope needed)
 *   - /users/{user}/settings/billing/ai_credit/usage → per-model cost breakdown
 *   - /orgs/{org}/settings/billing/ai_credit/usage   → org-level billing
 *
 * Returns Result<GitHubBillingData> — never throws.
 * Caches per scope for 5 minutes; uses p-retry (3 attempts, exponential backoff).
 */
import pRetry from 'p-retry';
import { err, ok, ResultAsync } from 'neverthrow';
import { z } from 'zod';
import * as vscode from 'vscode';
import type { IAuthProvider, IBillingProvider } from './IBillingProvider';
import { GitHubBillingData, GitHubBillingItem, GitHubQuota } from '../domain/types';

const CACHE_TTL = 5 * 60 * 1000;
const FETCH_TIMEOUT = 5_000;
/** Billing/quota payloads are a few KB; anything larger is not GitHub. */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const GH_API = 'https://api.github.com';
const API_VERSION = '2026-03-10';

// ── Zod schemas ──────────────────────────────────────────────────────────────

const QuotaSchema = z.object({
  copilot_plan: z.string().optional(),
  quota_snapshots: z
    .object({
      premium_interactions: z
        .object({
          entitlement: z.number(),
          percent_remaining: z.number(),
          unlimited: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
  quota_reset_date: z.string().optional(),
});

const BillingItemSchema = z.object({
  model: z.string().optional(),
  sku: z.string().optional(),
  grossQuantity: z.number().optional(),
  grossAmount: z.number(),
  netAmount: z.number(),
});

const BillingResponseSchema = z.object({
  usageItems: z.array(BillingItemSchema).optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
  };
}

async function fetchJson(url: string, token: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: authHeaders(token),
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${url}`);
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await res.body?.cancel();
    throw new Error(`GitHub API response exceeds ${MAX_RESPONSE_BYTES} bytes: ${url}`);
  }
  const body = await res.text();
  if (body.length > MAX_RESPONSE_BYTES) {
    throw new Error(`GitHub API response exceeds ${MAX_RESPONSE_BYTES} bytes: ${url}`);
  }
  return JSON.parse(body) as unknown;
}

function fetchWithRetry(url: string, token: string): Promise<unknown> {
  return pRetry(() => fetchJson(url, token), {
    retries: 2,
    minTimeout: 500,
    maxTimeout: 2000,
    factor: 2,
  });
}

// ── Service ──────────────────────────────────────────────────────────────────

export class GitHubUsageService implements IBillingProvider {
  readonly name = 'GitHub billing';

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

  /** Cache keyed by scope URI (or 'user' for the global scope). */
  private readonly cache = new Map<string, { data: GitHubBillingData; at: number }>();
  private readonly _sub: vscode.Disposable;

  constructor(readonly session: IAuthProvider) {
    this._sub = session.onDidChange(() => {
      this.cache.clear();
      this._onDidChange.fire();
    });
  }

  /** Trigger an interactive sign-in prompt (no-op if using PAT auth). */
  async signIn(): Promise<void> {
    await this.session.getToken(true);
  }

  async needsPat(): Promise<boolean> {
    return this.session.needsPat();
  }

  /** Fetch quota + billing data. Returns cached result if fresh enough. */
  fetch(scope?: vscode.WorkspaceFolder): ResultAsync<GitHubBillingData, Error> {
    return ResultAsync.fromPromise(this._fetch(scope), (e) =>
      e instanceof Error ? e : new Error(String(e)),
    );
  }

  dispose(): void {
    this._sub.dispose();
    this._onDidChange.dispose();
  }

  private cacheKey(scope?: vscode.WorkspaceFolder): string {
    return scope ? scope.uri.toString() : 'user';
  }

  private async _fetch(scope?: vscode.WorkspaceFolder): Promise<GitHubBillingData> {
    const key = this.cacheKey(scope);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data;

    const auth = await this.session.getToken(false, scope);
    if (!auth) throw new Error('Not signed in');

    const { token } = auth;
    const org = this.session.getOrg(scope);

    const billingUrl = org
      ? `${GH_API}/orgs/${encodeURIComponent(org)}/settings/billing/ai_credit/usage?apiVersion=${API_VERSION}`
      : auth.username
        ? `${GH_API}/users/${encodeURIComponent(auth.username)}/settings/billing/ai_credit/usage?apiVersion=${API_VERSION}`
        : null;

    const [quotaRaw, billingRaw] = await Promise.all([
      fetchWithRetry(`${GH_API}/copilot_internal/user`, token).catch(() => null),
      billingUrl ? fetchWithRetry(billingUrl, token).catch(() => null) : Promise.resolve(null),
    ]);

    const quota = parseQuota(quotaRaw);
    const items = parseItems(billingRaw);
    const totalNetAmount = items.reduce((s, i) => s + i.netAmount, 0);

    const data: GitHubBillingData = { quota, items, fetchedAt: Date.now(), totalNetAmount };
    this.cache.set(key, { data, at: Date.now() });
    return data;
  }
}

function parseQuota(raw: unknown): GitHubQuota | null {
  const parsed = QuotaSchema.safeParse(raw);
  if (!parsed.success) return null;
  const parsedData = parsed.data;
  const pi = parsedData.quota_snapshots?.premium_interactions;
  if (!pi) return null;
  // percent_remaining is 0-100 (e.g. 81.25), not a 0-1 fraction.
  const used = Math.round(pi.entitlement * (1 - pi.percent_remaining / 100));
  const resetDate = parsedData.quota_reset_date ? new Date(parsedData.quota_reset_date).getTime() : null;
  return {
    plan: parsedData.copilot_plan ?? 'unknown',
    entitlement: pi.entitlement,
    used,
    resetDate: Number.isFinite(resetDate) ? resetDate : null,
    unlimited: pi.unlimited ?? false,
  };
}

function parseItems(raw: unknown): GitHubBillingItem[] {
  const parsed = BillingResponseSchema.safeParse(raw);
  if (!parsed.success) return [];
  return (parsed.data.usageItems ?? []).map((i) => ({
    model: i.model ?? 'unknown',
    sku: i.sku ?? 'unknown',
    grossAmount: i.grossAmount,
    netAmount: i.netAmount,
    grossQuantity: i.grossQuantity ?? 0,
  }));
}

// Re-export for tests
export { ok, err };
