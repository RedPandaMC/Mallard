import * as path from 'path';
import { FolderLike, LogParser } from '../LogParser';
import { ParseContext } from '../otelParse';
import { priceRequest } from '../../domain/pricing';
import { CostCategory, SourceKind, UsageEvent } from '../../domain/types';

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

function splitCost(cost: number, prompt: number, total: number): Partial<Record<CostCategory, number>> {
  const inputCost = (cost * prompt) / total;
  const out: Partial<Record<CostCategory, number>> = {};
  if (inputCost > 0) out.input = inputCost;
  const outputCost = cost - inputCost;
  if (outputCost > 0) out.output = outputCost;
  return out;
}

function matchFolderHash(projectHash: string, folders: ReadonlyArray<FolderLike>): FolderLike | undefined {
  return folders.find((wf) => {
    const hash = encodeURIComponent(wf.uri.fsPath).replace(/%/g, '').toLowerCase();
    return hash === projectHash;
  });
}

export class ClaudeCodeParser implements LogParser {
  readonly sourceKind: SourceKind = 'claude-code';

  private readonly getFolders: () => ReadonlyArray<FolderLike> | undefined;

  constructor(getFolders?: () => ReadonlyArray<FolderLike> | undefined) {
    this.getFolders = getFolders ?? (() => undefined);
  }

  canParse(filePath: string): boolean {
    return (
      path.basename(filePath).toLowerCase().endsWith('.jsonl') &&
      filePath.includes('.claude')
    );
  }

  resolveWorkspace(filePath: string): FolderLike | undefined {
    // filePath: /home/user/.claude/projects/<H>/session.jsonl
    // Claude Code hashes the workspace path as encodeURIComponent(fsPath).replace(/%/g,'').toLowerCase()
    const parts = filePath.split(path.sep);
    const projIdx = parts.findIndex((p) => p === 'projects') + 1;
    if (projIdx === 0 || projIdx >= parts.length) return undefined;
    const projectHash = parts[projIdx]!.toLowerCase();

    const folders = this.getFolders();
    if (!folders) return undefined;
    return matchFolderHash(projectHash, folders);
  }

  parse(content: string, ctx: ParseContext): UsageEvent[] {
    const events: UsageEvent[] = [];
    const fileKey = ctx.fileKey ?? 'cc';
    let offset = ctx.baseOffset ?? 0;

    for (const line of content.split('\n')) {
      const lineStart = offset;
      offset += line.length + 1;

      const trimmed = line.trim();
      if (!trimmed || trimmed[0] !== '{') continue;

      let rec: AnyRecord;
      try {
        rec = JSON.parse(trimmed) as AnyRecord;
      } catch {
        continue;
      }

      if (rec['type'] !== 'assistant') continue;

      const msg   = (rec['message'] as AnyRecord | undefined) ?? rec;
      const usage = (msg['usage'] as AnyRecord | undefined) ?? (rec['usage'] as AnyRecord | undefined);
      if (!usage) continue;

      const model = pick(
        { ...(msg as AnyRecord), ...(rec as AnyRecord) },
        ['model', 'gen_ai.request.model', 'gen_ai.response.model'],
      );
      if (!model) continue;

      const prompt     = num(usage['input_tokens']  ?? usage['prompt_tokens']);
      const completion = num(usage['output_tokens'] ?? usage['completion_tokens']);

      const tsRaw = rec['timestamp'] ?? rec['time'] ?? (msg as AnyRecord)['timestamp'];
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

      events.push({
        id: `claude-code:${fileKey}:${lineStart}`,
        ts,
        modelId: String(model),
        surface: 'chat',
        source: 'claude-code',
        ...(prompt     !== undefined ? { promptTokens:     prompt     } : {}),
        ...(completion !== undefined ? { completionTokens: completion } : {}),
        credits,
        cost,
        estimated: true,
        ...(ctx.repo   !== undefined ? { repo:   ctx.repo   } : {}),
        ...(ctx.branch !== undefined ? { branch: ctx.branch } : {}),
        ...(costByCategory !== undefined ? { costByCategory } : {}),
      });
    }

    return events;
  }
}
