import { strict as assert } from 'assert';
import { CopilotConnector } from '../../../src/ingest/CopilotConnector';
import type { ParseContext } from '../../../src/ingest/otelParse';
import type { PricingService } from '../../../src/pricing/PricingService';
import type { MetaStore } from '../../../src/store/MetaStore';
import type { DuckDBFileReader } from '../../../src/store/DuckDBFileReader';

const now = new Date('2026-01-15T10:00:00.000Z').getTime();

function makeConnector(): CopilotConnector {
  const pricing = { pricePerCredit: 0.04, currentManifest: undefined } as unknown as PricingService;
  const meta = { get: async () => null, set: async () => {} } as MetaStore;
  const fileReader = {} as DuckDBFileReader;
  return new CopilotConnector(pricing, meta, fileReader);
}

function makeCtx(overrides?: Partial<ParseContext>): ParseContext {
  return { pricePerCredit: 0.04, now, ...overrides };
}

const baseAttrs = {
  'gen_ai.request.model': 'gpt-4o',
  'gen_ai.usage.input_tokens': 100,
  'gen_ai.usage.output_tokens': 50,
};

function makeConnectorWithLogPath(logPath: string): CopilotConnector {
  const pricing = { pricePerCredit: 0.04, currentManifest: undefined } as unknown as PricingService;
  const meta = { get: async () => null, set: async () => {} } as MetaStore;
  const fileReader = {} as DuckDBFileReader;
  return new CopilotConnector(pricing, meta, fileReader, undefined, logPath);
}

describe('CopilotConnector — lifecycle', () => {
  it('watermarkKey returns "copilot:watermark"', () => {
    const connector = makeConnector();
    assert.equal(
      (connector as unknown as { watermarkKey: string }).watermarkKey,
      'copilot:watermark',
    );
  });

  it('discover() returns an object with globs/allowedRoots/searchedDirs arrays', async () => {
    const connector = makeConnector();
    const result = await (connector as unknown as {
      discover(): Promise<{ globs: string[]; allowedRoots: string[]; searchedDirs: string[] }>;
    }).discover();
    assert.ok(Array.isArray(result.globs));
    assert.ok(Array.isArray(result.allowedRoots));
    assert.ok(Array.isArray(result.searchedDirs));
  });

  it('discover() returns globs when a log dir path override points to an existing dir', async () => {
    const connector = makeConnectorWithLogPath('/tmp');
    const result = await (connector as unknown as {
      discover(): Promise<{ globs: string[]; allowedRoots: string[]; searchedDirs: string[] }>;
    }).discover();
    assert.ok(result.globs.length > 0, 'globs should be non-empty when /tmp exists');
    assert.ok(result.allowedRoots.includes('/tmp'));
    assert.ok(result.searchedDirs.includes('/tmp'));
  });
});

describe('CopilotConnector.mapRow()', () => {
  it('returns null when no model field is present', () => {
    const connector = makeConnector();
    const result = connector.mapRow({ attributes: {} }, makeCtx());
    assert.equal(result, null);
  });

  it('extracts model, tokens, and sets source to "local"', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      { timestamp: '2026-01-15T10:00:00.000Z', attributes: baseAttrs },
      makeCtx(),
    );
    assert.ok(result);
    assert.equal(result.modelId, 'gpt-4o');
    assert.equal(result.source, 'local');
    assert.equal(result.promptTokens, 100);
    assert.equal(result.completionTokens, 50);
  });

  it('uses row.time as fallback when timestamp is absent', () => {
    const connector = makeConnector();
    const time = '2026-01-15T10:00:00.000Z';
    const result = connector.mapRow(
      { time, attributes: baseAttrs },
      makeCtx(),
    );
    assert.ok(result);
    assert.equal(result.ts, new Date(time).getTime());
  });

  it('falls through to attrs.timestamp when both row.timestamp and row.time are absent', () => {
    const connector = makeConnector();
    const ts = '2026-01-15T10:00:00.000Z';
    const result = connector.mapRow(
      { attributes: { ...baseAttrs, timestamp: ts } },
      makeCtx(),
    );
    assert.ok(result);
    assert.equal(result.ts, new Date(ts).getTime());
  });

  it('falls back to ctx.now for NaN timestamp', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      { timestamp: 'not-a-date', attributes: baseAttrs },
      makeCtx(),
    );
    assert.ok(result);
    assert.equal(result.ts, now);
  });

  it('falls back to ctx.now when timestamp is an object', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      { timestamp: { value: 1 }, attributes: baseAttrs },
      makeCtx(),
    );
    assert.ok(result);
    assert.equal(result.ts, now);
  });

  it('uses numeric timestamp directly', () => {
    const connector = makeConnector();
    const ts = 1700000000000;
    const result = connector.mapRow(
      { timestamp: ts, attributes: baseAttrs },
      makeCtx(),
    );
    assert.ok(result);
    assert.equal(result.ts, ts);
  });

  it('uses rec-level attributes when rec.attributes is absent', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      { timestamp: '2026-01-15T10:00:00.000Z', 'gen_ai.request.model': 'gpt-4o' },
      makeCtx(),
    );
    assert.ok(result);
    assert.equal(result.modelId, 'gpt-4o');
  });

  it('sets surface via toSurface — inline/completion', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      { timestamp: '2026-01-15T10:00:00.000Z', attributes: { ...baseAttrs, 'gen_ai.operation.surface': 'completion' } },
      makeCtx(),
    );
    assert.equal(result?.surface, 'inline');
  });

  it('sets surface via toSurface — agent', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      { timestamp: '2026-01-15T10:00:00.000Z', attributes: { ...baseAttrs, 'gen_ai.operation.surface': 'agent' } },
      makeCtx(),
    );
    assert.equal(result?.surface, 'agent');
  });

  it('sets surface via toSurface — edit', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      { timestamp: '2026-01-15T10:00:00.000Z', attributes: { ...baseAttrs, 'gen_ai.operation.surface': 'edit' } },
      makeCtx(),
    );
    assert.equal(result?.surface, 'edit');
  });

  it('sets surface via toSurface — chat', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      { timestamp: '2026-01-15T10:00:00.000Z', attributes: { ...baseAttrs, 'gen_ai.operation.surface': 'chat' } },
      makeCtx(),
    );
    assert.equal(result?.surface, 'chat');
  });

  it('sets surface to "unknown" for unrecognised value', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      { timestamp: '2026-01-15T10:00:00.000Z', attributes: { ...baseAttrs, 'gen_ai.operation.surface': 'something_new' } },
      makeCtx(),
    );
    assert.equal(result?.surface, 'unknown');
  });

  it('includes repo from ctx', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      { timestamp: '2026-01-15T10:00:00.000Z', attributes: baseAttrs },
      makeCtx({ repo: 'org/repo' }),
    );
    assert.equal(result?.repo, 'org/repo');
  });

  it('includes branch from ctx', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      { timestamp: '2026-01-15T10:00:00.000Z', attributes: baseAttrs },
      makeCtx({ branch: 'main' }),
    );
    assert.equal(result?.branch, 'main');
  });

  it('omits costByCategory when totalTok is 0', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      { timestamp: '2026-01-15T10:00:00.000Z', attributes: { 'gen_ai.request.model': 'gpt-4o' } },
      makeCtx(),
    );
    assert.ok(result);
    assert.equal(result.costByCategory, undefined);
  });

  it('rejects negative token counts — stored as undefined', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      {
        timestamp: '2026-01-15T10:00:00.000Z',
        attributes: { 'gen_ai.request.model': 'gpt-4o', 'gen_ai.usage.input_tokens': -100, 'gen_ai.usage.output_tokens': 50 },
      },
      makeCtx(),
    );
    assert.ok(result);
    assert.equal(result.promptTokens, undefined);
    assert.equal(result.completionTokens, 50);
  });

  it('parses string token values via num()', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      {
        timestamp: '2026-01-15T10:00:00.000Z',
        attributes: { 'gen_ai.request.model': 'gpt-4o', 'gen_ai.usage.input_tokens': '100', 'gen_ai.usage.output_tokens': '50' },
      },
      makeCtx(),
    );
    assert.ok(result);
    assert.equal(result.promptTokens, 100);
    assert.equal(result.completionTokens, 50);
  });

  it('applies manifest multiplier from ctx', () => {
    const connector = makeConnector();
    const manifest = { version: 1, pricePerCredit: 0.05, updatedAt: '2026-01-01', models: { 'gpt-4o': 3, unknown: 1 } };
    const result = connector.mapRow(
      { timestamp: '2026-01-15T10:00:00.000Z', attributes: baseAttrs },
      makeCtx({ manifest }),
    );
    assert.ok(result);
    assert.equal(result.credits, 3);
  });

  it('uses filename column from DuckDB row for id uniqueness', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      { timestamp: '2026-01-15T10:00:00.000Z', attributes: baseAttrs, filename: '/logs/copilot-chat.log' },
      makeCtx(),
    );
    assert.ok(result);
    assert.ok(!result.id.includes(':cp:'), 'id should use file hash, not fallback "cp"');
  });

  it('falls back to "cp" fileKey when filename is absent', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      { timestamp: '2026-01-15T10:00:00.000Z', attributes: baseAttrs },
      makeCtx(),
    );
    assert.ok(result);
    assert.ok(result.id.includes(':cp:'), 'id should use "cp" fallback');
  });

  it('covers splitCost when only output tokens exist', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      { timestamp: '2026-01-15T10:00:00.000Z', attributes: { 'gen_ai.request.model': 'gpt-4o', 'gen_ai.usage.output_tokens': 50 } },
      makeCtx(),
    );
    assert.ok(result?.costByCategory?.['output'] !== undefined);
  });
});
