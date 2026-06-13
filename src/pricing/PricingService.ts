/**
 * Loads and caches the Copilot pricing manifest.
 *
 * Priority: cached (if < 24h old) → fetch from remote URL → bundled fallback.
 * Validates the fetched payload before caching — never executes it.
 */
import { promises as fs } from 'fs';
import * as https from 'https';
import * as path from 'path';
import { PricingManifest } from '../domain/pricing';

const CACHE_FILE = 'pricing-manifest.json';
const REMOTE_URL =
  'https://raw.githubusercontent.com/RedPandaMC/weevil/main/media/pricing-manifest.json';
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

function isValidManifest(v: unknown): v is PricingManifest {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.version === 'number' &&
    typeof m.pricePerCredit === 'number' &&
    m.pricePerCredit > 0 &&
    typeof m.models === 'object' &&
    m.models !== null
  );
}

function fetchManifest(url: string): Promise<PricingManifest> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: FETCH_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!isValidManifest(parsed)) {
            reject(new Error('Invalid manifest shape'));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
  });
}

export class PricingService {
  private manifest: PricingManifest;
  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly storageDir: string,
    bundled: PricingManifest,
    private readonly remoteUrl: string = REMOTE_URL,
  ) {
    this.manifest = bundled;
  }

  get pricePerCredit(): number {
    return this.manifest.pricePerCredit;
  }

  get currentManifest(): PricingManifest {
    return this.manifest;
  }

  async load(): Promise<void> {
    const cached = await this.loadCached();
    if (cached) {
      this.manifest = cached;
    }
    // Kick off a non-blocking remote refresh.
    void this.tryRemoteRefresh();
  }

  startDailyRefresh(): void {
    this.refreshTimer = setInterval(
      () => void this.tryRemoteRefresh(),
      REFRESH_INTERVAL_MS,
    );
  }

  dispose(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  private async loadCached(): Promise<PricingManifest | null> {
    const file = path.join(this.storageDir, CACHE_FILE);
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!isValidManifest(parsed)) return null;
      const age = Date.now() - Date.parse((parsed as PricingManifest).updatedAt);
      if (Number.isFinite(age) && age < REFRESH_INTERVAL_MS) return parsed;
      return null;
    } catch {
      return null;
    }
  }

  private async tryRemoteRefresh(): Promise<void> {
    if (!this.remoteUrl) return;
    try {
      const fetched = await fetchManifest(this.remoteUrl);
      this.manifest = fetched;
      await this.cache(fetched);
    } catch {
      // Network failures are silent — we continue with the current manifest.
    }
  }

  private async cache(m: PricingManifest): Promise<void> {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      await fs.writeFile(
        path.join(this.storageDir, CACHE_FILE),
        JSON.stringify({ ...m, updatedAt: new Date().toISOString() }),
        'utf8',
      );
    } catch {
      // Cache write failures are silent.
    }
  }
}
