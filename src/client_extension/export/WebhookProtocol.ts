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
 *   - mTLS client certificates: when certFile/keyFile/caFile are supplied,
 *     requests are sent via Node.js https.request (which supports TLS client
 *     certs) instead of the global fetch().
 *   - Retry with exponential backoff on 5xx / network error (p-retry).
 *   - 10-second per-request timeout.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as https from 'https';
import * as vscode from 'vscode';
import pRetry, { AbortError } from 'p-retry';
import type { RetryContext } from 'p-retry';
import type { MetricProtocol } from './MetricExporter';
import { defaultLogger, Logger } from '../util/logger';

const REQUEST_TIMEOUT_MS = 10_000;

export interface WebhookProtocolOptions {
  url: string;
  secret?: string;
  headers?: Record<string, string>;
  retries?: number;
  certFile?: string;
  keyFile?: string;
  caFile?: string;
}

export class WebhookProtocol implements MetricProtocol {
  private readonly opts: WebhookProtocolOptions;
  private active = true;

  constructor(opts: WebhookProtocolOptions, private readonly logger: Logger = defaultLogger) {
    if (!opts.url.startsWith('https://')) {
      void vscode.window.showWarningMessage(
        'Mallard: mallard.server.url must use https:// (TLS required). ' +
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
    const { url, secret, headers = {}, retries = 3, certFile, keyFile, caFile } = this.opts;

    const extraHeaders: Record<string, string> = { ...headers, 'Content-Type': 'application/json' };

    if (secret) {
      const sig = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
      extraHeaders['X-Mallard-Signature-256'] = `sha256=${sig}`;
    }

    const hasCert = !!(certFile || keyFile || caFile);

    await pRetry(
      async () => {
        const status = hasCert
          ? await this._postWithClientCert(url, body, extraHeaders, {
              ...(certFile ? { certFile } : {}),
              ...(keyFile ? { keyFile } : {}),
              ...(caFile ? { caFile } : {}),
            })
          : await this._postWithFetch(url, body, extraHeaders);

        if (status >= 500) {
          throw new Error(`HTTP ${status} from webhook endpoint`);
        }
        if (status >= 400) {
          // 4xx = client error; abort immediately (no retry).
          throw new AbortError(`HTTP ${status} from webhook endpoint`);
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

  private async _postWithFetch(
    url: string,
    body: string,
    headers: Record<string, string>,
  ): Promise<number> {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return res.status;
  }

  private _postWithClientCert(
    url: string,
    body: string,
    headers: Record<string, string>,
    certOpts: { certFile?: string; keyFile?: string; caFile?: string },
  ): Promise<number> {
    const agentOpts: https.AgentOptions = {};
    if (certOpts.certFile) agentOpts.cert = fs.readFileSync(certOpts.certFile);
    if (certOpts.keyFile) agentOpts.key = fs.readFileSync(certOpts.keyFile);
    if (certOpts.caFile) agentOpts.ca = fs.readFileSync(certOpts.caFile);

    const agent = new https.Agent(agentOpts);
    const parsedUrl = new URL(url);
    const bodyBuffer = Buffer.from(body, 'utf8');

    return new Promise<number>((resolve, reject) => {
      const req = https.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || 443,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'POST',
          headers: { ...headers, 'Content-Length': bodyBuffer.byteLength },
          agent,
          timeout: REQUEST_TIMEOUT_MS,
        },
        (res) => {
          res.resume(); // drain response body to free the socket
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Request timeout')));
      req.write(bodyBuffer);
      req.end();
    });
  }

  dispose(): void {
    this.active = false;
  }
}
