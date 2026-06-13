/**
 * Fetches authoritative Copilot usage data from the GitHub API.
 *
 * Two endpoints:
 *   - copilot_internal/user          → quota/plan info (no extra scope needed)
 *   - /users/{user}/settings/billing/ai_credit/usage → per-model cost breakdown
 *
 * Returns Result<GitHubBillingData> — never throws.
 * Caches for 5 minutes; uses p-retry (3 attempts, exponential backoff).
 */
import pRetry from 'p-retry';
import { err, ok, ResultAsync } from 'neverthrow';
import { z } from 'zod';
import * as vscode from 'vscode';
import { GitHubSession } from '../auth/GitHubSession';
import { GitHubBillingData, GitHubBillingItem, GitHubQuota } from '../model/types';

const CACHE_TTL = 5 * 60 * 1000;
const FETCH_TIMEOUT = 5_000;
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
  return res.json() as Promise<unknown>;
}

function fetchWithRetry(url: string, token: string): Promise<unknown> {
  return pRetry(() => fetchJson(url, token), {
    retries: 2,
    minTimeout: 500,
    factor: 2,
  });
}

// ── Service ──────────────────────────────────────────────────────────────────

export class GitHubUsageService implements vscode.Disposable {
  private cache: { data: GitHubBillingData; at: number } | null = null;
  private readonly _sub: vscode.Disposable;

  constructor(readonly session: GitHubSession) {
    this._sub = session.onDidChange(() => {
      this.cache = null; // invalidate on auth change
    });
  }

  /** Fetch quota + billing data. Returns cached result if fresh enough. */
  fetch(): ResultAsync<GitHubBillingData, Error> {
    return ResultAsync.fromPromise(this._fetch(), (e) =>
      e instanceof Error ? e : new Error(String(e)),
    );
  }

  dispose(): void {
    this._sub.dispose();
  }

  private async _fetch(): Promise<GitHubBillingData> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL) {
      return this.cache.data;
    }

    const githubSession = await this.session.get(false);
    if (!githubSession) throw new Error('Not signed in');

    const token = githubSession.accessToken;
    const username = githubSession.account.label;

    const [quotaRaw, billingRaw] = await Promise.all([
      fetchWithRetry(`${GH_API}/copilot_internal/user`, token).catch(() => null),
      fetchWithRetry(
        `${GH_API}/users/${encodeURIComponent(username)}/settings/billing/ai_credit/usage?apiVersion=${API_VERSION}`,
        token,
      ).catch(() => null),
    ]);

    const quota = parseQuota(quotaRaw);
    const items = parseItems(billingRaw);
    const totalNetAmount = items.reduce((s, i) => s + i.netAmount, 0);

    const data: GitHubBillingData = {
      quota,
      items,
      fetchedAt: Date.now(),
      totalNetAmount,
    };
    this.cache = { data, at: Date.now() };
    return data;
  }
}

function parseQuota(raw: unknown): GitHubQuota | null {
  const parsed = QuotaSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;
  const pi = d.quota_snapshots?.premium_interactions;
  if (!pi) return null;
  const used = Math.round(pi.entitlement * (1 - pi.percent_remaining));
  const resetDate = d.quota_reset_date ? new Date(d.quota_reset_date).getTime() : null;
  return {
    plan: d.copilot_plan ?? 'unknown',
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
