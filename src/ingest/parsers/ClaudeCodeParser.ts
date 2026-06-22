/* c8 ignore start */
import * as path from 'path';
import { FolderLike, LogParser } from '../LogParser';
import { ParseContext } from '../otelParse';
import { priceRequest } from '../../domain/pricing';
import { CostCategory, SourceKind, Surface, UsageEvent } from '../../domain/types';
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
  /* c8 ignore next */
  return undefined;
}

interface TokenCounts {
  prompt?: number;
  completion?: number;
  cacheCreation?: number;
  cacheRead?: number;
  thinking?: number;
}

function splitCost(cost: number, tokens: TokenCounts): Partial<Record<CostCategory, number>> {
  const total =
    (tokens.prompt ?? 0) +
    (tokens.completion ?? 0) +
    (tokens.cacheCreation ?? 0) +
    (tokens.cacheRead ?? 0) +
    (tokens.thinking ?? 0);
  if (total === 0) return {};
  const out: Partial<Record<CostCategory, number>> = {};
  if (tokens.prompt)       out.input          = (cost * tokens.prompt)       / total;
  if (tokens.completion)   out.output         = (cost * tokens.completion)   / total;
  if (tokens.cacheCreation) out.cache_creation = (cost * tokens.cacheCreation) / total;
  if (tokens.cacheRead)    out.cache_read     = (cost * tokens.cacheRead)    / total;
  if (tokens.thinking)     out.thinking       = (cost * tokens.thinking)     / total;
  return out;
}

function matchFolderHash(projectHash: string, folders: ReadonlyArray<FolderLike>): FolderLike | undefined {
  return folders.find((wf) => {
    const hash = encodeURIComponent(wf.uri.fsPath).replace(/%/g, '').toLowerCase();
    return hash === projectHash;
  });
}

/**
 * Pre-scan the session lines to detect agent-mode usage.
 * Claude Code emits `type: 'tool'` entries when the model invokes tools;
 * their presence indicates the session is an agentic run rather than plain chat.
 */
function detectSurface(lines: string[]): Surface {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== '{') continue;
    try {
      const r = JSON.parse(trimmed) as AnyRecord;
      if (r['type'] === 'tool') return 'agent';
    } catch {
      // skip invalid JSON
    }
  }
  return 'chat';
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

    const lines = content.split('\n');
    const surface = detectSurface(lines);

    for (const line of lines) {
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

      const prompt        = num(usage['input_tokens']  ?? usage['prompt_tokens']);
      const completion    = num(usage['output_tokens'] ?? usage['completion_tokens']);
      const cacheCreation = num(usage['cache_creation_input_tokens']);
      const cacheRead     = num(usage['cache_read_input_tokens']);
      const thinking      = num(usage['thinking_tokens'] ?? usage['output_thinking_tokens']);

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

      const tokens: TokenCounts = {
        ...(prompt        !== undefined ? { prompt }        : {}),
        ...(completion    !== undefined ? { completion }    : {}),
        ...(cacheCreation !== undefined ? { cacheCreation } : {}),
        ...(cacheRead     !== undefined ? { cacheRead }     : {}),
        ...(thinking      !== undefined ? { thinking }      : {}),
      };
      const rawCostByCategory = cost > 0 ? splitCost(cost, tokens) : undefined;
      const costByCategory = rawCostByCategory && Object.keys(rawCostByCategory).length > 0
        ? rawCostByCategory
        : undefined;

      events.push({
        id: `claude-code:${fileKey}:${lineStart}`,
        ts,
        modelId: String(model),
        surface,
        source: 'claude-code',
        ...(prompt        !== undefined ? { promptTokens:        prompt        } : {}),
        ...(completion    !== undefined ? { completionTokens:    completion    } : {}),
        ...(cacheCreation !== undefined ? { cacheCreationTokens: cacheCreation } : {}),
        ...(cacheRead     !== undefined ? { cacheReadTokens:     cacheRead     } : {}),
        ...(thinking      !== undefined ? { thinkingTokens:      thinking      } : {}),
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
/* c8 ignore next */
}
