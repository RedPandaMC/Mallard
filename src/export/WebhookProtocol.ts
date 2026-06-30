/**
 * HTTP webhook transport for metric export.
 *
 * Security:
 *   - HTTPS only: plain http:// URLs are rejected with a warning.
 *   - HMAC-SHA256 request signature: every POST includes a
 *     `X-Mallard-Signature-256: sha256=<hex>` header keyed with the user-
 *     supplied `secret`. Receivers can verify authenticity without exposing
 *     credentials in the URL.
 *   - Configurable auth header (e.g. `Authorization: Bearer ...`).
 *   - Retry with exponential backoff on 5xx / network error (p-retry).
 *   - 10-second per-request timeout.
 */
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import pRetry, { AbortError } from 'p-retry';
import type { RetryContext } from 'p-retry';
import type { MetricProtocol } from './MetricExporter';
import { defaultLogger, Logger } from '../util/logger';

const REQUEST_TIMEOUT_MS = 10_000;

export interface WebhookProtocolOptions {
  url: string;
  apiKey?: string;
  secret?: string;
  headers?: Record<string, string>;
  retries?: number;
}

export class WebhookProtocol implements MetricProtocol {
  private readonly opts: WebhookProtocolOptions;
  private active = true;

  constructor(opts: WebhookProtocolOptions, private readonly logger: Logger = defaultLogger) {
    if (!opts.url.startsWith('https://')) {
      void vscode.window.showWarningMessage(
        'Mallard: metricExport.webhook.url must use https:// (TLS required). ' +
          'Webhook export is disabled until a secure URL is configured.',
      );
      this.opts = { url: '' };
      return;
    }
    this.opts = opts;
  }

  send(_topic: string, payload: Record<string, unknown>): void {
    if (!this.active || !this.opts.url) return;
    const body = JSON.stringify(payload);
    void this.post(body).catch((err: unknown) => {
      this.logger.error('webhook', 'export failed:', (err as Error).message);
    });
  }

  private async post(body: string): Promise<void> {
    const { url, apiKey, secret, headers = {}, retries = 3 } = this.opts;

    const extraHeaders: Record<string, string> = { ...headers, 'Content-Type': 'application/json' };

    if (apiKey) {
      extraHeaders['X-API-Key'] = apiKey;
    }

    if (secret) {
      const sig = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
      extraHeaders['X-Mallard-Signature-256'] = `sha256=${sig}`;
    }

    await pRetry(
      async () => {
        const res = await fetch(url, {
          method: 'POST',
          headers: extraHeaders,
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (res.status >= 500) {
          // p-retry treats thrown errors as retryable.
          throw new Error(`HTTP ${res.status} from webhook endpoint`);
        }
        if (!res.ok) {
          // 4xx = client error; abort immediately (no retry).
          throw new AbortError(`HTTP ${res.status} from webhook endpoint`);
        }
      },
      {
        retries,
        minTimeout: 1_000,
        factor: 2,
        onFailedAttempt: (ctx: RetryContext) => {
          this.logger.warn('webhook', `attempt ${ctx.attemptNumber} failed:`, ctx.error.message);
        },
      },
    );
  }

  dispose(): void {
    this.active = false;
  }
}
