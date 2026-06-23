/* c8 ignore start */
import * as path from 'path';
import { ParseContext } from './otelParse';
import { locateCopilotLogDirs } from './locate';
import { priceRequest } from '../domain/pricing';
import { CostCategory, Surface, UsageEvent } from '../domain/types';
import { PricingService } from '../pricing/PricingService';
import { DuckDBFileReader } from '../store/DuckDBFileReader';
import type { MetaStore } from '../store/MetaStore';
import { BaseFileConnector } from './BaseFileConnector';
/* c8 ignore stop */

type AnyRecord = Record<string, unknown>;

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : undefined;
  return n != null && !Number.isNaN(n) && n >= 0 ? n : undefined;
}

function pick(attrs: AnyRecord, keys: string[]): unknown {
  for (const k of keys) {
    if (attrs[k] != null) return attrs[k];
  }
  return undefined;
}

function splitCost(cost: number, prompt: number, total: number): Partial<Record<CostCategory, number>> {
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

/** djb2 hash — stable short key for a file path, used to namespace event ids. */
function fileKeyOf(filePath: string): string {
  let hash = 5381;
  for (let i = 0; i < filePath.length; i++) hash = ((hash << 5) + hash + filePath.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export class CopilotConnector extends BaseFileConnector {
  readonly id = 'copilot';
  readonly displayName = 'GitHub Copilot';

  constructor(
    pricing: PricingService,
    meta: MetaStore,
    fileReader: DuckDBFileReader,
    private readonly logUri?: string,
    private readonly logPath?: string,
  ) {
    super(pricing, meta, fileReader);
  }

  protected get watermarkKey(): string {
    return 'copilot:watermark';
  }

  protected async discover(): Promise<{ globs: string[]; allowedRoots: string[]; searchedDirs: string[] }> {
    const dirs = await locateCopilotLogDirs(this.logUri, this.logPath);
    if (dirs.length === 0) return { globs: [], allowedRoots: [], searchedDirs: [] };

    this.logPaths = dirs;
    // Copilot logs are NDJSON files under the VS Code log dirs.
    // Use broad glob; mapRow filters for Copilot-specific fields.
    const globs = dirs.map((d) => path.join(d, '**'));
    return { globs, allowedRoots: dirs, searchedDirs: dirs };
  }

  protected mapRow(row: AnyRecord, ctx: ParseContext): UsageEvent | null {
    const attrs = (row['attributes'] as AnyRecord | undefined) ?? row;
    const model = pick(attrs, ['gen_ai.request.model', 'gen_ai.response.model', 'model']);
    if (!model) return null;

    const prompt = num(
      pick(attrs, ['gen_ai.usage.input_tokens', 'gen_ai.usage.prompt_tokens', 'input_tokens']),
    );
    const completion = num(
      pick(attrs, ['gen_ai.usage.output_tokens', 'gen_ai.usage.completion_tokens', 'output_tokens']),
    );

    const tsRaw = row['timestamp'] ?? row['time'] ?? attrs['timestamp'];
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

    const totalTok = (prompt ?? 0) + (completion ?? 0);
    const costByCategory =
      cost > 0 && totalTok > 0 ? splitCost(cost, prompt ?? 0, totalTok) : undefined;

    const surfaceHint =
      pick(attrs, ['gen_ai.operation.surface', 'surface', 'gen_ai.operation.name']) ?? row['name'];

    // Stable id: hash of the file path is unavailable in DuckDB row mode,
    // so we use a hash of the model+timestamp combination as a discriminator.
    const fileKey = typeof row['__filename'] === 'string' ? fileKeyOf(row['__filename']) : 'cp';
    const rowKey = `${fileKey}:${ts}:${String(model)}`;

    return {
      id: `local:${rowKey}`,
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
    };
  }
}
