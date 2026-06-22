/* c8 ignore start */
import * as path from 'path';
import { FolderLike, LogParser } from '../LogParser';
import { ParseContext } from '../otelParse';
import { priceRequest } from '../../domain/pricing';
import { SourceKind, UsageEvent } from '../../domain/types';
import { fileKeyOf, num, splitCost, toSurface } from './parserUtils';
/* c8 ignore stop */

type AnyRecord = Record<string, unknown>;

function pick(attrs: AnyRecord, keys: string[]): unknown {
  for (const k of keys) {
    if (attrs[k] != null) return attrs[k];
  }
  return undefined;
}

export class OtelParser implements LogParser {
  readonly sourceKind: SourceKind = 'local';

  canParse(filePath: string): boolean {
    const name = path.basename(filePath).toLowerCase();
    return (
      name.includes('copilot') &&
      (name.endsWith('.log') ||
        name.endsWith('.json') ||
        /* c8 ignore next 2 */
        name.endsWith('.ndjson') ||
        name.endsWith('.otel.json'))
    );
  }

  resolveWorkspace(_filePath: string): FolderLike | undefined {
    return undefined;
  }

  parse(content: string, ctx: ParseContext): UsageEvent[] {
    const events: UsageEvent[] = [];
    const fileKey = ctx.fileKey ?? fileKeyOf('f');
    let offset = ctx.baseOffset ?? 0;

    for (const line of content.split('\n')) {
      const lineStart = offset;
      offset += line.length + 1;

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
        pick(attrs, ['gen_ai.usage.output_tokens', 'gen_ai.usage.completion_tokens', 'output_tokens']),
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

      const rawCost = cost > 0 ? splitCost(cost, {
        ...(prompt !== undefined ? { prompt } : {}),
        ...(completion !== undefined ? { completion } : {}),
      }) : undefined;
      const costByCategory = rawCost && Object.keys(rawCost).length > 0 ? rawCost : undefined;

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
  /* c8 ignore next */
}
