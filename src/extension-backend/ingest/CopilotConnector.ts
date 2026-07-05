/* c8 ignore next */
import * as path from 'path';
import { ParseContext } from './otelParse';
import { priceRequest, priceTokens } from '../domain/pricing';
import { UsageEvent } from '../domain/types';
import { PricingService } from '../pricing/PricingService';
import { DuckDBFileReader } from '../store/DuckDBFileReader';
import type { IMetaStore as MetaStore } from '../store/MetaStore';
import { BaseFileConnector } from './BaseFileConnector';
import {
  AnyRecord,
  fileKeyOf,
  flattenOtelAttributes,
  num,
  parseTimestamp,
  pick,
  splitCostSimple,
  toSurface,
} from './connectorUtils';
import type { CopilotOtelSource } from '../config';
import type { ConnectorCapabilities, DiscoverResult } from './LogConnector';
import type { SetupRequirement } from './SetupRequirement';
import type { IFsWatcher } from './IFsWatcher';
import type { Logger } from '../util/logger';

/** DuckDB query for the SQLite span source (attached as `mallard_otel`). */
const SQLITE_SPAN_QUERY = 'SELECT * FROM mallard_otel.spans';

/**
 * GitHub Copilot connector. Copilot writes no usage log by default; local usage
 * requires its OpenTelemetry exporter, whose target (a JSONL file or SQLite DB)
 * is resolved from settings by `resolveOtel`. When nothing is configured the
 * connector reports empty and its [[SetupRequirement]] nudges the user to enable
 * the exporter (see ConnectorSetupGate).
 */
export class CopilotConnector extends BaseFileConnector {
  readonly id = 'copilot';
  readonly displayName = 'GitHub Copilot';

  readonly capabilities: ConnectorCapabilities = {
    tokenFields: ['promptTokens', 'completionTokens'],
    costCategories: ['input', 'output'],
    supportsRepoAttribution: true,
    sources: ['ndjson', 'sqlite'],
  };

  constructor(
    pricing: PricingService,
    meta: MetaStore,
    fileReader: DuckDBFileReader,
    private readonly resolveOtel: () => CopilotOtelSource,
    private readonly setupRequirements: SetupRequirement[] = [],
    fsWatcher?: IFsWatcher,
    logger?: Logger,
  ) {
    super(pricing, meta, fileReader, fsWatcher, logger);
  }

  override getSetupRequirements(): SetupRequirement[] {
    return this.setupRequirements;
  }

  protected async discover(): Promise<DiscoverResult> {
    const otel = this.resolveOtel();
    if (otel.kind === 'none') return { globs: [], allowedRoots: [], searchedDirs: [] };

    const dir = path.dirname(otel.path);
    this.logPaths = [otel.path];
    if (otel.kind === 'sqlite') {
      return { kind: 'sqlite', dbPath: otel.path, query: SQLITE_SPAN_QUERY, allowedRoots: [dir], searchedDirs: [dir] };
    }
    // Forward slashes for DuckDB glob compatibility on Windows.
    return { globs: [otel.path.replace(/\\/g, '/')], allowedRoots: [dir], searchedDirs: [dir] };
  }

  mapRow(row: AnyRecord, ctx: ParseContext): UsageEvent | null {
    // OTel spans nest usage under `attributes` (OTLP array or flat map); other
    // shapes keep fields at the top level.
    const attrs = row['attributes'] !== undefined ? flattenOtelAttributes(row['attributes']) : row;
    const model = pick(attrs, ['gen_ai.request.model', 'gen_ai.response.model', 'model']);
    if (!model) return null;

    const prompt     = num(pick(attrs, ['gen_ai.usage.input_tokens',  'gen_ai.usage.prompt_tokens',     'input_tokens']));
    const completion = num(pick(attrs, ['gen_ai.usage.output_tokens', 'gen_ai.usage.completion_tokens', 'output_tokens']));
    const ts         = parseTimestamp(row) ?? parseTimestamp(attrs);
    if (ts === undefined) return null;

    const { credits, cost: creditCost } = priceRequest(String(model), {
      pricePerCredit: ctx.pricePerCredit,
      currency: 'USD',
      ...(ctx.manifest !== undefined ? { manifest: ctx.manifest } : {}),
    });

    // Exact per-token cost (inline completions included) when the price feed
    // knows the model; the credit-multiplier estimate is the fallback.
    const tokenCost = priceTokens(
      String(model),
      { ...(prompt !== undefined ? { prompt } : {}), ...(completion !== undefined ? { completion } : {}) },
      ctx.tokenPrices,
    );
    const cost = tokenCost?.total ?? creditCost;

    const totalTok = (prompt ?? 0) + (completion ?? 0);
    const costByCategory =
      tokenCost?.byCategory ??
      (cost > 0 && totalTok > 0 ? splitCostSimple(cost, prompt ?? 0, totalTok) : undefined);

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
