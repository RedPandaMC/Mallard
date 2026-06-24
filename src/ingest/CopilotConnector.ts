/* c8 ignore next */
import * as path from 'path';
import { ParseContext } from './otelParse';
import { locateCopilotLogDirs } from './locate';
import { priceRequest } from '../domain/pricing';
import { UsageEvent } from '../domain/types';
import { PricingService } from '../pricing/PricingService';
import { DuckDBFileReader } from '../store/DuckDBFileReader';
import type { IMetaStore as MetaStore } from '../store/MetaStore';
import { BaseFileConnector } from './BaseFileConnector';
import {
  AnyRecord,
  fileKeyOf,
  num,
  parseTimestamp,
  pick,
  splitCostSimple,
  toSurface,
} from './connectorUtils';
import type { ConnectorCapabilities } from './LogConnector';
import type { IFsWatcher } from './IFsWatcher';
import type { Logger } from '../util/logger';

export class CopilotConnector extends BaseFileConnector {
  readonly id = 'copilot';
  readonly displayName = 'GitHub Copilot';

  readonly capabilities: ConnectorCapabilities = {
    tokenFields: ['promptTokens', 'completionTokens'],
    costCategories: ['input', 'output'],
    supportsRepoAttribution: true,
  };

  constructor(
    pricing: PricingService,
    meta: MetaStore,
    fileReader: DuckDBFileReader,
    /* c8 ignore next */
    private readonly logUri?: string,
    /* c8 ignore next */
    private readonly logPath?: string,
    fsWatcher?: IFsWatcher,
    logger?: Logger,
  ) {
    super(pricing, meta, fileReader, fsWatcher, logger);
  }

  protected async discover(): Promise<{ globs: string[]; allowedRoots: string[]; searchedDirs: string[] }> {
    /* c8 ignore next */
    const dirs = await locateCopilotLogDirs(this.logUri, this.logPath);
    if (dirs.length === 0) return { globs: [], allowedRoots: [], searchedDirs: [] };

    /* c8 ignore start */
    this.logPaths = dirs;
    const globs = dirs.map((d) => path.join(d, '**'));
    return { globs, allowedRoots: dirs, searchedDirs: dirs };
    /* c8 ignore stop */
  }

  mapRow(row: AnyRecord, ctx: ParseContext): UsageEvent | null {
    const attrs = (row['attributes'] as AnyRecord | undefined) ?? row;
    const model = pick(attrs, ['gen_ai.request.model', 'gen_ai.response.model', 'model']);
    if (!model) return null;

    const prompt     = num(pick(attrs, ['gen_ai.usage.input_tokens',  'gen_ai.usage.prompt_tokens',     'input_tokens']));
    const completion = num(pick(attrs, ['gen_ai.usage.output_tokens', 'gen_ai.usage.completion_tokens', 'output_tokens']));
    const ts         = parseTimestamp(row, ctx.now);

    const { credits, cost } = priceRequest(String(model), {
      pricePerCredit: ctx.pricePerCredit,
      currency: 'USD',
      ...(ctx.manifest !== undefined ? { manifest: ctx.manifest } : {}),
    });

    const totalTok = (prompt ?? 0) + (completion ?? 0);
    const costByCategory =
      cost > 0 && totalTok > 0 ? splitCostSimple(cost, prompt ?? 0, totalTok) : undefined;

    const surfaceHint =
      pick(attrs, ['gen_ai.operation.surface', 'surface', 'gen_ai.operation.name']) ?? row['name'];

    const fileKey = typeof row['filename'] === 'string' ? fileKeyOf(row['filename']) : 'cp';
    const rowKey  = `${fileKey}:${ts}:${String(model)}`;

    return {
      id:     `local:${rowKey}`,
      ts,
      modelId: String(model),
      surface: toSurface(surfaceHint),
      source:  'local',
      ...(prompt      !== undefined ? { promptTokens:     prompt }      : {}),
      ...(completion  !== undefined ? { completionTokens: completion }   : {}),
      credits,
      cost,
      estimated: true,
      ...(ctx.repo   !== undefined ? { repo:   ctx.repo }   : {}),
      ...(ctx.branch !== undefined ? { branch: ctx.branch } : {}),
      ...(costByCategory !== undefined ? { costByCategory } : {}),
    };
  }
  /* c8 ignore next */
}
