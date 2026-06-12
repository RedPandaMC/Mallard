/**
 * Parse Copilot OTel/JSON-lines telemetry into estimated UsageEvents. Tolerant
 * by design: unknown/malformed lines are skipped; records without a model are
 * ignored. Token counts and credits are flagged `estimated`.
 */
import { priceRequest } from '../../../model/pricing';
import { PricingManifest } from '../../../model/pricing';
import { Surface, UsageEvent } from '../../../model/types';

export interface ParseContext {
  pricePerCredit: number;
  manifest?: PricingManifest;
  now: number;
}

type AnyRecord = Record<string, unknown>;

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : undefined;
  return n != null && !Number.isNaN(n) ? n : undefined;
}

function pick(attrs: AnyRecord, keys: string[]): unknown {
  for (const k of keys) {
    if (attrs[k] != null) return attrs[k];
  }
  return undefined;
}

function toSurface(v: unknown): Surface {
  const s = String(v ?? '').toLowerCase();
  if (s.includes('inline') || s.includes('completion')) return 'inline';
  if (s.includes('agent')) return 'agent';
  if (s.includes('edit')) return 'edit';
  if (s.includes('chat')) return 'chat';
  return 'unknown';
}

export function parseOtelContent(content: string, ctx: ParseContext): UsageEvent[] {
  const events: UsageEvent[] = [];
  let i = 0;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) continue;

    let rec: AnyRecord;
    try {
      rec = JSON.parse(trimmed) as AnyRecord;
    } catch {
      continue;
    }

    const attrs = (rec.attributes as AnyRecord) ?? rec;
    const model = pick(attrs, ['gen_ai.request.model', 'gen_ai.response.model', 'model']);
    if (!model) continue;

    const prompt = num(
      pick(attrs, ['gen_ai.usage.input_tokens', 'gen_ai.usage.prompt_tokens', 'input_tokens']),
    );
    const completion = num(
      pick(attrs, [
        'gen_ai.usage.output_tokens',
        'gen_ai.usage.completion_tokens',
        'output_tokens',
      ]),
    );

    const tsRaw = rec.timestamp ?? rec.time ?? attrs['timestamp'];
    let ts =
      typeof tsRaw === 'string'
        ? Date.parse(tsRaw)
        : typeof tsRaw === 'number'
          ? tsRaw
          : ctx.now;
    if (Number.isNaN(ts)) ts = ctx.now;

    const { credits, cost } = priceRequest(String(model), {
      pricePerCredit: ctx.pricePerCredit,
      currency: 'USD',
      manifest: ctx.manifest,
    });
    events.push({
      id: `local:${ts}:${i++}:${model}`,
      ts,
      modelId: String(model),
      surface: toSurface(pick(attrs, ['gen_ai.operation.surface', 'surface'])),
      source: 'local',
      promptTokens: prompt,
      completionTokens: completion,
      credits,
      cost,
      estimated: true,
    });
  }

  return events;
}
