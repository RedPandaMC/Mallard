import { strict as assert } from 'assert';
import * as path from 'path';
import { CopilotConnector } from '../../../src/extension-backend/ingest/CopilotConnector';
import type { CopilotOtelSource } from '../../../src/extension-backend/config';
import type { SetupRequirement } from '../../../src/extension-backend/ingest/SetupRequirement';
import type { ParseContext } from '../../../src/extension-backend/ingest/otelParse';
import type { PricingService } from '../../../src/extension-backend/pricing/PricingService';
import type { IMetaStore as MetaStore } from '../../../src/extension-backend/store/MetaStore';
import type { DuckDBFileReader } from '../../../src/extension-backend/store/DuckDBFileReader';

const now = new Date('2026-01-15T10:00:00.000Z').getTime();
const NONE: CopilotOtelSource = { kind: 'none', path: '' };

function makeConnector(
  resolveOtel: () => CopilotOtelSource = () => NONE,
  requirements: SetupRequirement[] = [],
): CopilotConnector {
  const pricing = { pricePerCredit: 0.04, currentManifest: undefined } as unknown as PricingService;
  const meta = { get: async () => null, set: async () => {} } as MetaStore;
  const fileReader = {} as DuckDBFileReader;
  return new CopilotConnector(pricing, meta, fileReader, resolveOtel, requirements);
}

function makeCtx(overrides?: Partial<ParseContext>): ParseContext {
  return { pricePerCredit: 0.04, now, ...overrides };
}

const baseAttrs = {
  'gen_ai.request.model': 'gpt-4o',
  'gen_ai.usage.input_tokens': 100,
  'gen_ai.usage.output_tokens': 50,
};

type DiscoverShape = {
  globs?: string[];
  kind?: string;
  dbPath?: string;
  query?: string;
  allowedRoots: string[];
  searchedDirs: string[];
};
const discoverOf = (c: CopilotConnector): Promise<DiscoverShape> =>
  (c as unknown as { discover(): Promise<DiscoverShape> }).discover();

describe('CopilotConnector — lifecycle', () => {
  it('watermarkKey returns "copilot:watermark"', () => {
    const connector = makeConnector();
    assert.equal(
      (connector as unknown as { watermarkKey: string }).watermarkKey,
      'copilot:watermark',
    );
  });

  it('discover() returns an empty ndjson target when no OTel source is configured', async () => {
    const result = await discoverOf(makeConnector(() => NONE));
    assert.deepEqual(result.globs, []);
    assert.deepEqual(result.allowedRoots, []);
    assert.deepEqual(result.searchedDirs, []);
  });

  it('discover() returns an ndjson glob at the configured OTel outfile', async () => {
    const file = path.join('/tmp', 'otel', 'copilot.jsonl');
    const result = await discoverOf(makeConnector(() => ({ kind: 'ndjson', path: file })));
    assert.equal(result.globs?.length, 1);
    assert.ok(result.globs?.[0]?.endsWith('copilot.jsonl'));
    assert.ok(!result.globs?.[0]?.includes('\\'), 'globs use forward slashes');
    assert.ok(result.allowedRoots.includes(path.dirname(file)));
  });

  it('discover() returns a sqlite target when the OTel source is a DB', async () => {
    const db = path.join('/tmp', 'otel', 'copilot.sqlite');
    const result = await discoverOf(makeConnector(() => ({ kind: 'sqlite', path: db })));
    assert.equal(result.kind, 'sqlite');
    assert.equal(result.dbPath, db);
    assert.ok(typeof result.query === 'string' && result.query.includes('mallard_otel'));
  });

  it('getSetupRequirements() returns the injected requirements', () => {
    const req = { id: 'copilot-otel' } as unknown as SetupRequirement;
    assert.deepEqual(makeConnector(() => NONE, [req]).getSetupRequirements(), [req]);
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

  it('gives two same-model/timestamp spans distinct ids via span id', () => {
    const connector = makeConnector();
    const ts = '2026-01-15T10:00:00.000Z';
    const a = connector.mapRow({ timestamp: ts, span_id: 'span-a', attributes: baseAttrs }, makeCtx());
    const b = connector.mapRow({ timestamp: ts, span_id: 'span-b', attributes: baseAttrs }, makeCtx());
    assert.ok(a && b);
    assert.notEqual(a.id, b.id, 'distinct span ids must yield distinct ids');
  });

  it('reuses the same id for the same span id (re-ingest dedups)', () => {
    const connector = makeConnector();
    const row = { timestamp: '2026-01-15T10:00:00.000Z', span_id: 'span-x', attributes: baseAttrs };
    const first = connector.mapRow(row, makeCtx());
    const second = connector.mapRow(row, makeCtx());
    assert.ok(first && second);
    assert.equal(first.id, second.id);
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

  it('skips rows with an unparseable timestamp (would mis-bucket into "now")', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      { timestamp: 'not-a-date', attributes: baseAttrs },
      makeCtx(),
    );
    assert.equal(result, null);
  });

  it('skips rows whose timestamp is an object', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      { timestamp: { value: 1 }, attributes: baseAttrs },
      makeCtx(),
    );
    assert.equal(result, null);
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
