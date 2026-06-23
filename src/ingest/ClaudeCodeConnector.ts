/* c8 ignore start */
import * as path from 'path';
import * as vscode from 'vscode';
import { ParseContext } from './otelParse';
import { locateClaudeCodeLogDirs } from './locate';
import { priceRequest } from '../domain/pricing';
import { CostCategory, Surface, UsageEvent } from '../domain/types';
import { PricingService } from '../pricing/PricingService';
import { DuckDBFileReader } from '../store/DuckDBFileReader';
import type { MetaStore } from '../store/MetaStore';
import { BaseFileConnector } from './BaseFileConnector';
import { num, pick } from './connectorUtils';
/* c8 ignore stop */

type AnyRecord = Record<string, unknown>;

function splitCost(
  cost: number,
  tokens: {
    prompt?: number;
    completion?: number;
    cacheCreation?: number;
    cacheRead?: number;
    thinking?: number;
  },
): Partial<Record<CostCategory, number>> {
  const total =
    (tokens.prompt ?? 0) +
    (tokens.completion ?? 0) +
    (tokens.cacheCreation ?? 0) +
    (tokens.cacheRead ?? 0) +
    (tokens.thinking ?? 0);
  if (total === 0) return {};
  const out: Partial<Record<CostCategory, number>> = {};
  if (tokens.prompt)        out.input          = (cost * tokens.prompt)        / total;
  if (tokens.completion)    out.output         = (cost * tokens.completion)    / total;
  if (tokens.cacheCreation) out.cache_creation = (cost * tokens.cacheCreation) / total;
  if (tokens.cacheRead)     out.cache_read     = (cost * tokens.cacheRead)     / total;
  if (tokens.thinking)      out.thinking       = (cost * tokens.thinking)      / total;
  return out;
}

function matchFolderHash(
  projectHash: string,
  folders: ReadonlyArray<vscode.WorkspaceFolder>,
): vscode.WorkspaceFolder | undefined {
  return folders.find((wf) => {
    const hash = encodeURIComponent(wf.uri.fsPath).replace(/%/g, '').toLowerCase();
    return hash === projectHash;
  });
}

export class ClaudeCodeConnector extends BaseFileConnector {
  readonly id = 'claude-code';
  readonly displayName = 'Claude Code';

  constructor(
    pricing: PricingService,
    meta: MetaStore,
    fileReader: DuckDBFileReader,
    private readonly getFolders: () => ReadonlyArray<vscode.WorkspaceFolder> | undefined,
  ) {
    super(pricing, meta, fileReader);
  }

  protected get watermarkKey(): string {
    return 'claude-code:watermark';
  }

  protected async discover(): Promise<{ globs: string[]; allowedRoots: string[]; searchedDirs: string[] }> {
    const dirs = await locateClaudeCodeLogDirs();
    /* c8 ignore next */
    if (dirs.length === 0) return { globs: [], allowedRoots: [], searchedDirs: [] };

    this.logPaths = dirs;
    const globs = dirs.map((d) => path.join(d, '**', '*.jsonl'));
    return { globs, allowedRoots: dirs, searchedDirs: dirs };
  }

  protected override async buildContext(globs: string[]): Promise<ParseContext> {
    const base = await super.buildContext(globs);
    const isAgent = await this.fileReader.hasField(globs, 'type', 'tool');
    return { ...base, surface: isAgent ? 'agent' : 'chat' };
  }

  mapRow(row: AnyRecord, ctx: ParseContext): UsageEvent | null {
    if (row['type'] !== 'assistant') return null;

    const msg   = (row['message']  as AnyRecord | undefined) ?? row;
    const usage = (msg['usage']    as AnyRecord | undefined) ?? (row['usage'] as AnyRecord | undefined);
    if (!usage) return null;

    const model = pick(
      { ...msg, ...row },
      ['model', 'gen_ai.request.model', 'gen_ai.response.model'],
    );
    if (!model) return null;

    const prompt        = num(usage['input_tokens']  ?? usage['prompt_tokens']);
    const completion    = num(usage['output_tokens'] ?? usage['completion_tokens']);
    const cacheCreation = num(usage['cache_creation_input_tokens']);
    const cacheRead     = num(usage['cache_read_input_tokens']);
    const thinking      = num(usage['thinking_tokens'] ?? usage['output_thinking_tokens']);

    const tsRaw = row['timestamp'] ?? row['time'] ?? (msg as AnyRecord)['timestamp'];
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

    const tokens = {
      ...(prompt        !== undefined ? { prompt }        : {}),
      ...(completion    !== undefined ? { completion }    : {}),
      ...(cacheCreation !== undefined ? { cacheCreation } : {}),
      ...(cacheRead     !== undefined ? { cacheRead }     : {}),
      ...(thinking      !== undefined ? { thinking }      : {}),
    };
    const rawCbc = cost > 0 ? splitCost(cost, tokens) : undefined;
    const costByCategory = rawCbc && Object.keys(rawCbc).length > 0 ? rawCbc : undefined;

    const surface: Surface = ctx.surface ?? 'agent';

    // sessionId is the last 8 chars of the session UUID — enough to discriminate
    // concurrent turns without exposing the full id in event keys.
    const sessionKey = typeof row['sessionId'] === 'string' ? row['sessionId'].slice(-8) : 'cc';

    let repo = ctx.repo;
    const folders = this.getFolders();
    if (folders) {
      const sessionId = typeof row['sessionId'] === 'string' ? row['sessionId'] : undefined;
      if (sessionId) {
        const matched = matchFolderHash(sessionId.toLowerCase(), folders);
        if (matched) repo = matched.name;
      }
    }

    return {
      id: `claude-code:${sessionKey}:${ts}:${String(model)}`,
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
      ...(repo !== undefined ? { repo } : {}),
      ...(ctx.branch !== undefined ? { branch: ctx.branch } : {}),
      ...(costByCategory !== undefined ? { costByCategory } : {}),
    };
  }
/* c8 ignore next */
}
