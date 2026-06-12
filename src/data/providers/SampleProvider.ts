/**
 * Deterministic, realistic sample data so the dashboard always renders even
 * with no Copilot logs and no sign-in. Seeded PRNG → stable output for a given
 * (days, now), which also keeps tests reproducible.
 */
import { priceRequest } from '../../model/pricing';
import { ProviderStatus, SourceKind, Surface, UsageEvent } from '../../model/types';
import { DAY_MS, startOf } from '../../util/time';
import { ProviderContext, ProviderResult, UsageProvider } from '../UsageProvider';

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MODELS = ['gpt-4o', 'claude-sonnet-4', 'o4-mini', 'gpt-4o-mini', 'claude-opus-4'];
const REPOS = ['weevil', 'web-app', 'infra'];
const SURFACES: Surface[] = ['chat', 'inline', 'agent', 'edit'];

export class SampleProvider implements UsageProvider {
  readonly kind: SourceKind = 'sample';

  constructor(private readonly days = 120) {}

  async probe(): Promise<ProviderStatus> {
    return { kind: 'ok', reason: 'Sample data' };
  }

  async fetch(
    range: { start: number; end: number },
    ctx: ProviderContext,
  ): Promise<ProviderResult> {
    const rand = mulberry32(1337);
    const events: UsageEvent[] = [];
    const today = startOf(ctx.now, 'day');

    for (let d = this.days; d >= 0; d--) {
      const dayStart = today - d * DAY_MS;
      const dow = new Date(dayStart).getDay();
      const weekday = dow >= 1 && dow <= 5;
      const base = weekday ? 8 : 2;
      const count = Math.floor(base + rand() * base);

      for (let i = 0; i < count; i++) {
        const hour = 8 + Math.floor(rand() * 10);
        const ts = dayStart + hour * 3_600_000 + Math.floor(rand() * 3_600_000);
        if (ts < range.start || ts >= range.end) continue;

        const modelId = MODELS[Math.floor(rand() * MODELS.length)];
        const repo = REPOS[Math.floor(rand() * REPOS.length)];
        const surface = SURFACES[Math.floor(rand() * SURFACES.length)];
        const { credits, cost } = priceRequest(modelId, ctx);

        events.push({
          id: `sample:${ts}:${i}`,
          ts,
          modelId,
          surface,
          source: 'sample',
          promptTokens: 200 + Math.floor(rand() * 4000),
          completionTokens: 50 + Math.floor(rand() * 1500),
          credits,
          cost,
          estimated: true,
          repo,
          workspaceFolder: repo,
        });
      }
    }

    return { events, status: { kind: 'ok', reason: 'Sample data' } };
  }
}
