/**
 * Fetches USD-based FX rates from the Frankfurter open API and caches them
 * for 24 hours. Falls back to USD-only (all rates = 1.0) when offline.
 *
 * Endpoint: https://api.frankfurter.app/latest?from=USD
 */
import { promises as fs } from 'fs';
import * as https from 'https';
import * as path from 'path';
import { defaultLogger, Logger } from '../util/logger';

const CACHE_FILE = 'fx-rates.json';
const API_URL = 'https://api.frankfurter.app/latest?from=USD';
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
/** A full Frankfurter rates payload is well under 4 KB. */
const MAX_RESPONSE_BYTES = 1024 * 1024;

export type FxRates = Record<string, number>;

interface CachePayload {
  fetchedAt: string;
  rates: FxRates;
}

function fetchRates(url: string = API_URL, redirectsLeft: number = MAX_REDIRECTS): Promise<FxRates> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: FETCH_TIMEOUT_MS }, (res) => {
      const status = res.statusCode ?? 0;
      // Follow redirects — Frankfurter has moved hosts (.app ↔ .dev) before, and
      // https.get does not follow 30x on its own, so a redirect would otherwise
      // silently strand rates at USD-only.
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new Error('Too many redirects'));
          return;
        }
        resolve(fetchRates(new URL(res.headers.location, url).toString(), redirectsLeft - 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      let received = 0;
      res.on('data', (c: Buffer) => {
        received += c.length;
        if (received > MAX_RESPONSE_BYTES) {
          req.destroy(new Error(`Response exceeds ${MAX_RESPONSE_BYTES} bytes`));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            rates?: Record<string, number>;
          };
          if (!body.rates || typeof body.rates !== 'object') {
            reject(new Error('Unexpected Frankfurter response shape'));
            return;
          }
          // Include USD itself at 1.0 so callers never need a special case.
          resolve({ USD: 1, ...body.rates });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
  });
}

export class CurrencyService {
  private rates: FxRates = { USD: 1 };
  private refreshTimer?: ReturnType<typeof setInterval>;

  /** Invoked after a background refresh actually changes the rates, so the
   *  dashboard can recompute (the initial load never blocks on the network). */
  onRatesUpdated?: () => void;

  constructor(
    private readonly storageDir: string,
    private readonly logger: Logger = defaultLogger,
  ) {}

  /** Returns the latest cached rates (USD = 1.0, others relative to USD). */
  currentRates(): FxRates {
    return this.rates;
  }

  async load(): Promise<void> {
    // Never block activation on the network. Populate from the local cache when
    // available (USD-only default otherwise), and always refresh in the
    // background; onRatesUpdated triggers a recompute once real rates arrive.
    // Previously a cold/stale cache awaited the fetch here, which could stall
    // activation for up to ~20s (redirects × 5s timeouts) on a slow network.
    const cached = await this.loadCached();
    if (cached) this.rates = cached;
    void this.tryRefresh();
  }

  startDailyRefresh(): void {
    this.refreshTimer = setInterval(() => void this.tryRefresh(), REFRESH_INTERVAL_MS);
  }

  dispose(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  async clearCache(): Promise<void> {
    try {
      await fs.rm(path.join(this.storageDir, CACHE_FILE), { force: true });
    } /* c8 ignore next 2 */ catch {
      // Nothing cached.
    }
  }

  private async loadCached(): Promise<FxRates | null> {
    const file = path.join(this.storageDir, CACHE_FILE);
    try {
      const raw = await fs.readFile(file, 'utf8');
      const payload = JSON.parse(raw) as CachePayload;
      if (!payload.rates || typeof payload.rates !== 'object') return null;
      const age = Date.now() - Date.parse(payload.fetchedAt);
      if (Number.isFinite(age) && age < REFRESH_INTERVAL_MS) return payload.rates;
      return null;
    } catch {
      return null;
    }
  }

  private async tryRefresh(): Promise<void> {
    try {
      const rates = await fetchRates();
      const changed = JSON.stringify(rates) !== JSON.stringify(this.rates);
      this.rates = rates;
      await this.writeCache(rates);
      if (changed) this.onRatesUpdated?.();
    } catch (err) {
      // Keep the last known rates; log so a stuck USD-only selector is diagnosable.
      this.logger.debug('currency', `FX refresh failed: ${String(err)}`);
    }
  }

  private async writeCache(rates: FxRates): Promise<void> {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      const payload: CachePayload = { fetchedAt: new Date().toISOString(), rates };
      await fs.writeFile(path.join(this.storageDir, CACHE_FILE), JSON.stringify(payload), 'utf8');
    } /* c8 ignore next 2 */ catch {
      // Cache write failures are silent.
    }
  }
}
