/**
 * Parse Copilot OTel/JSON-lines telemetry into estimated UsageEvents. Tolerant
 * by design: unknown/malformed lines are skipped; records without a model are
 * ignored. Token counts and credits are flagged `estimated`.
 */
import { priceRequest } from '../domain/pricing';
import { PricingManifest } from '../domain/pricing';
import { CostCategory, Surface, UsageEvent } from '../domain/types';

export interface ParseContext {
  pricePerCredit: number;
  manifest?: PricingManifest;
  now: number;
  /** Repo to attribute these events to (active workspace repo at parse time). */
  repo?: string;
  /** Git branch active at parse time. */
  branch?: string;
  /** Stable per-file key so ids are unique across log files. */
  fileKey?: string;
  /**
   * Absolute character offset where `content` begins in the source file. With a
   * per-line offset this yields ids that are stable whether the file is parsed
   * in full or incrementally, so re-parsing never duplicates or drops events.
   */
  baseOffset?: number;
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

function splitCost(
  cost: number,
  prompt: number,
  total: number,
): Partial<Record<CostCategory, number>> {
  const inputCost = (cost * prompt) / total;
  const out: Partial<Record<CostCategory, number>> = {};
  if (inputCost > 0) out.input = inputCost;
  const outputCost = cost - inputCost;
  if (outputCost > 0) out.output = outputCost;
  return out;
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
  const fileKey = ctx.fileKey ?? 'f';
  let offset = ctx.baseOffset ?? 0;

  for (const line of content.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1; // +1 for the consumed '\n'

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
      ...(ctx.manifest !== undefined ? { manifest: ctx.manifest } : {}),
    });

    // Split cost into input/output categories by token ratio when both are
    // known. Copilot's local OTel logs only expose input/output token counts
    // (no cached/reasoning/tool/cost attributes), so tool and thinking stay
    // unpopulated until a richer source is available. Absent tokens -> no split.
    const totalTok = (prompt ?? 0) + (completion ?? 0);
    const costByCategory =
      cost > 0 && totalTok > 0 ? splitCost(cost, prompt ?? 0, totalTok) : undefined;

    // Surface comes from an explicit attribute when present, else the span name
    // (e.g. "chat", "invoke_agent").
    const surfaceHint =
      pick(attrs, ['gen_ai.operation.surface', 'surface', 'gen_ai.operation.name']) ?? rec['name'];

    events.push({
      id: `local:${fileKey}:${lineStart}`,
      ts,
      modelId: String(model),
      surface: toSurface(surfaceHint),
      source: 'local',
      ...(prompt !== undefined ? { promptTokens: prompt } : {}),
      ...(completion !== undefined ? { completionTokens: completion } : {}),
      credits,
      cost,
      estimated: true,
      ...(ctx.repo !== undefined ? { repo: ctx.repo } : {}),
      ...(ctx.branch !== undefined ? { branch: ctx.branch } : {}),
      ...(costByCategory !== undefined ? { costByCategory } : {}),
    });
  }

  return events;
}
