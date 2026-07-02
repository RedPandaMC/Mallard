/* c8 ignore next */
import * as path from 'path';
import { ParseContext } from './otelParse';
import { locateClaudeCodeLogDirs } from './locate';
import { priceRequest } from '../domain/pricing';
import { Surface, UsageEvent } from '../domain/types';
import { PricingService } from '../pricing/PricingService';
import { DuckDBFileReader } from '../store/DuckDBFileReader';
import type { IMetaStore as MetaStore } from '../store/MetaStore';
import { BaseFileConnector } from './BaseFileConnector';
import {
  AnyRecord,
  num,
  parseTimestamp,
  splitCostByBreakdown,
  TokenBreakdown,
} from './connectorUtils';
import type { ConnectorCapabilities } from './LogConnector';
import type { IWorkspaceFolderMatcher } from './WorkspaceFolderMatcher';
import type { IFsWatcher } from './IFsWatcher';
import type { Logger } from '../util/logger';

export class ClaudeCodeConnector extends BaseFileConnector {
  readonly id = 'claude-code';
  readonly displayName = 'Claude Code';

  readonly capabilities: ConnectorCapabilities = {
    tokenFields: ['promptTokens', 'completionTokens', 'cacheCreationTokens', 'cacheReadTokens', 'thinkingTokens'],
    costCategories: ['input', 'output', 'cache_creation', 'cache_read', 'thinking'],
    supportsRepoAttribution: true,
  };

  constructor(
    pricing: PricingService,
    meta: MetaStore,
    fileReader: DuckDBFileReader,
    private readonly folderMatcher: IWorkspaceFolderMatcher,
    fsWatcher?: IFsWatcher,
    logger?: Logger,
  ) {
    super(pricing, meta, fileReader, fsWatcher, logger);
  }

  protected async discover(): Promise<{ globs: string[]; allowedRoots: string[]; searchedDirs: string[] }> {
    const dirs = await locateClaudeCodeLogDirs();
    /* c8 ignore next */
    if (dirs.length === 0) return { globs: [], allowedRoots: [], searchedDirs: [] };

    /* c8 ignore start */
    this.logPaths = dirs;
    const globs = dirs.map((d) => path.join(d, '**', '*.jsonl'));
    return { globs, allowedRoots: dirs, searchedDirs: dirs };
    /* c8 ignore stop */
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

    const model = String(
      (msg as AnyRecord)['model'] ??
      row['model'] ??
      (msg as AnyRecord)['gen_ai.request.model'] ??
      row['gen_ai.request.model'] ?? '',
    );
    if (!model) return null;

    const prompt        = num(usage['input_tokens']  ?? usage['prompt_tokens']);
    const completion    = num(usage['output_tokens'] ?? usage['completion_tokens']);
    const cacheCreation = num(usage['cache_creation_input_tokens']);
    const cacheRead     = num(usage['cache_read_input_tokens']);
    const thinking      = num(usage['thinking_tokens'] ?? usage['output_thinking_tokens']);
    const ts            = parseTimestamp({ ...row, ...msg });
    if (ts === undefined) return null;

    const { credits, cost } = priceRequest(model, {
      pricePerCredit: ctx.pricePerCredit,
      currency: 'USD',
      ...(ctx.manifest !== undefined ? { manifest: ctx.manifest } : {}),
    });

    const tokens: TokenBreakdown = {
      ...(prompt        !== undefined ? { prompt }        : {}),
      ...(completion    !== undefined ? { completion }    : {}),
      ...(cacheCreation !== undefined ? { cacheCreation } : {}),
      ...(cacheRead     !== undefined ? { cacheRead }     : {}),
      ...(thinking      !== undefined ? { thinking }      : {}),
    };
    const rawCbc       = cost > 0 ? splitCostByBreakdown(cost, tokens) : undefined;
    const costByCategory = rawCbc && Object.keys(rawCbc).length > 0 ? rawCbc : undefined;

    const surface: Surface = ctx.surface ?? 'agent';

    const sessionId  = typeof row['sessionId'] === 'string' ? row['sessionId'] : undefined;
    const sessionKey = sessionId ? sessionId.slice(-8) : 'cc';
    const resolvedRepo = sessionId ? this.folderMatcher.resolve(sessionId) : undefined;
    const repo = resolvedRepo ?? ctx.repo;

    return {
      id:      `claude-code:${sessionKey}:${ts}:${model}`,
      ts,
      modelId: model,
      surface,
      source:  'claude-code',
      ...(prompt        !== undefined ? { promptTokens:        prompt }        : {}),
      ...(completion    !== undefined ? { completionTokens:    completion }    : {}),
      ...(cacheCreation !== undefined ? { cacheCreationTokens: cacheCreation } : {}),
      ...(cacheRead     !== undefined ? { cacheReadTokens:     cacheRead }     : {}),
      ...(thinking      !== undefined ? { thinkingTokens:      thinking }      : {}),
      credits,
      cost,
      estimated: true,
      ...(repo       !== undefined ? { repo }          : {}),
      ...(ctx.branch !== undefined ? { branch: ctx.branch } : {}),
      ...(costByCategory !== undefined ? { costByCategory } : {}),
    };
  }
  /* c8 ignore next */
}
