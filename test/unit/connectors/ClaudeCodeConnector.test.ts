import { strict as assert } from 'assert';
import { ClaudeCodeConnector } from '../../../src/extension/ingest/ClaudeCodeConnector';
import { WorkspaceFolderMatcher } from '../../../src/extension/ingest/WorkspaceFolderMatcher';
import type { IWorkspaceFolderMatcher } from '../../../src/extension/ingest/WorkspaceFolderMatcher';
import type { ParseContext } from '../../../src/extension/ingest/otelParse';
import type { PricingService } from '../../../src/extension/pricing/PricingService';
import type { IMetaStore as MetaStore } from '../../../src/extension/store/MetaStore';
import type { DuckDBFileReader } from '../../../src/extension/store/DuckDBFileReader';

const noopMatcher: IWorkspaceFolderMatcher = { resolve: () => undefined };

const now = new Date('2026-01-15T10:00:00.000Z').getTime();

function makeConnector(matcher?: IWorkspaceFolderMatcher): ClaudeCodeConnector {
  const pricing = { pricePerCredit: 0.04, currentManifest: undefined } as unknown as PricingService;
  const meta = { get: async () => null, set: async () => {} } as MetaStore;
  const fileReader = {} as DuckDBFileReader;
  return new ClaudeCodeConnector(pricing, meta, fileReader, matcher ?? noopMatcher);
}

function makeConnectorWithHasField(hasFieldResult: boolean): ClaudeCodeConnector {
  const pricing = { pricePerCredit: 0.04, currentManifest: undefined } as unknown as PricingService;
  const meta = { get: async () => null, set: async () => {} } as MetaStore;
  const fileReader = { hasField: async () => hasFieldResult } as unknown as DuckDBFileReader;
  return new ClaudeCodeConnector(pricing, meta, fileReader, noopMatcher);
}

function makeCtx(overrides?: Partial<ParseContext>): ParseContext {
  return { pricePerCredit: 0.04, now, ...overrides };
}

function makeLine(overrides: Record<string, unknown>) {
  return {
    type: 'assistant',
    message: { model: 'claude-sonnet-4', usage: { input_tokens: 100, output_tokens: 50 } },
    timestamp: '2026-01-15T10:00:00.000Z',
    ...overrides,
  };
}

describe('ClaudeCodeConnector — lifecycle', () => {
  it('watermarkKey returns "claude-code:watermark"', () => {
    const connector = makeConnector();
    assert.equal(
      (connector as unknown as { watermarkKey: string }).watermarkKey,
      'claude-code:watermark',
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

  it('buildContext() with hasField=true sets surface to "agent"', async () => {
    const connector = makeConnectorWithHasField(true);
    const ctx = await (connector as unknown as {
      buildContext(g: string[]): Promise<import('../../../src/extension/ingest/otelParse').ParseContext>;
    }).buildContext([]);
    assert.equal(ctx.surface, 'agent');
  });

  it('buildContext() with hasField=false sets surface to "chat"', async () => {
    const connector = makeConnectorWithHasField(false);
    const ctx = await (connector as unknown as {
      buildContext(g: string[]): Promise<import('../../../src/extension/ingest/otelParse').ParseContext>;
    }).buildContext([]);
    assert.equal(ctx.surface, 'chat');
  });
});

describe('ClaudeCodeConnector — folder attribution', () => {
  function makeFolderConnector(folders: Array<{ name: string; fsPath: string }>) {
    const pricing = { pricePerCredit: 0.04, currentManifest: undefined } as unknown as PricingService;
    const meta = { get: async () => null, set: async () => {} } as MetaStore;
    const fileReader = {} as DuckDBFileReader;
    const vscodeFolders = folders.map((f) => ({
      name: f.name,
      uri: { fsPath: f.fsPath },
    })) as unknown as ReadonlyArray<import('vscode').WorkspaceFolder>;
    const matcher = new WorkspaceFolderMatcher(() => vscodeFolders);
    return new ClaudeCodeConnector(pricing, meta, fileReader, matcher);
  }

  it('mapRow() uses folder name as repo when sessionId hash matches a folder', () => {
    const fsPath = '/home/user/myproject';
    // compute hash the same way as matchFolderHash:
    // encodeURIComponent(fsPath).replace(/%/g, '').toLowerCase()
    const hash = encodeURIComponent(fsPath).replace(/%/g, '').toLowerCase();
    const connector = makeFolderConnector([{ name: 'myproject', fsPath }]);
    const result = connector.mapRow(
      {
        type: 'assistant',
        message: { model: 'claude-sonnet-4', usage: { input_tokens: 10, output_tokens: 5 } },
        timestamp: '2026-01-15T10:00:00.000Z',
        sessionId: hash,
      },
      makeCtx(),
    );
    assert.ok(result);
    assert.equal(result.repo, 'myproject');
  });

  it('mapRow() falls back to ctx.repo when sessionId does not match any folder', () => {
    const connector = makeFolderConnector([{ name: 'myproject', fsPath: '/home/user/myproject' }]);
    const result = connector.mapRow(
      {
        type: 'assistant',
        message: { model: 'claude-sonnet-4', usage: { input_tokens: 10, output_tokens: 5 } },
        timestamp: '2026-01-15T10:00:00.000Z',
        sessionId: 'no-match-at-all',
      },
      makeCtx({ repo: 'ctx-repo' }),
    );
    assert.ok(result);
    assert.equal(result.repo, 'ctx-repo');
  });

  it('mapRow() skips folder matching when sessionId is absent', () => {
    const connector = makeFolderConnector([{ name: 'myproject', fsPath: '/tmp/x' }]);
    const result = connector.mapRow(
      {
        type: 'assistant',
        message: { model: 'claude-sonnet-4', usage: { input_tokens: 10, output_tokens: 5 } },
        timestamp: '2026-01-15T10:00:00.000Z',
      },
      makeCtx({ repo: 'fallback' }),
    );
    assert.ok(result);
    assert.equal(result.repo, 'fallback');
  });

  it('mapRow() returns empty folders list (getFolders returns [])', () => {
    const pricing = { pricePerCredit: 0.04, currentManifest: undefined } as unknown as PricingService;
    const meta = { get: async () => null, set: async () => {} } as MetaStore;
    const fileReader = {} as DuckDBFileReader;
    const matcher = new WorkspaceFolderMatcher(() => []);
    const connector = new ClaudeCodeConnector(pricing, meta, fileReader, matcher);
    const result = connector.mapRow(
      {
        type: 'assistant',
        message: { model: 'claude-sonnet-4', usage: { input_tokens: 10, output_tokens: 5 } },
        timestamp: '2026-01-15T10:00:00.000Z',
        sessionId: 'abc123',
      },
      makeCtx({ repo: 'fallback' }),
    );
    assert.ok(result);
    assert.equal(result.repo, 'fallback');
  });
});

describe('ClaudeCodeConnector.mapRow()', () => {
  it('returns null for non-assistant rows', () => {
    const connector = makeConnector();
    assert.equal(connector.mapRow({ type: 'user', message: 'hello' }, makeCtx()), null);
  });

  it('returns null when usage is absent', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      { type: 'assistant', message: { model: 'claude-sonnet-4' }, timestamp: '2026-01-15T10:00:00.000Z' },
      makeCtx(),
    );
    assert.equal(result, null);
  });

  it('returns null when model is absent', () => {
    const connector = makeConnector();
    const result = connector.mapRow(
      { type: 'assistant', usage: { input_tokens: 10, output_tokens: 5 }, timestamp: '2026-01-15T10:00:00.000Z' },
      makeCtx(),
    );
    assert.equal(result, null);
  });

  it('extracts model and tokens', () => {
    const connector = makeConnector();
    const result = connector.mapRow(makeLine({}), makeCtx());
    assert.ok(result);
    assert.equal(result.modelId, 'claude-sonnet-4');
    assert.equal(result.source, 'claude-code');
    assert.equal(result.promptTokens, 100);
    assert.equal(result.completionTokens, 50);
  });

  it('uses top-level usage when usage is not inside message', () => {
    const connector = makeConnector();
    const row = { type: 'assistant', model: 'claude-haiku-4', usage: { input_tokens: 80, output_tokens: 40 }, timestamp: '2026-01-15T10:00:00.000Z' };
    const result = connector.mapRow(row, makeCtx());
    assert.ok(result);
    assert.equal(result.modelId, 'claude-haiku-4');
  });

  it('uses model from row level when not in message', () => {
    const connector = makeConnector();
    const row = { type: 'assistant', model: 'claude-opus-4', message: { usage: { input_tokens: 10, output_tokens: 5 } }, timestamp: '2026-01-15T10:00:00.000Z' };
    const result = connector.mapRow(row, makeCtx());
    assert.ok(result);
    assert.equal(result.modelId, 'claude-opus-4');
  });

  it('falls back to ctx.now for NaN timestamp', () => {
    const connector = makeConnector();
    const result = connector.mapRow(makeLine({ timestamp: 'garbage' }), makeCtx());
    assert.ok(result);
    assert.equal(result.ts, now);
  });

  it('uses ctx.now when timestamp is an object', () => {
    const connector = makeConnector();
    const result = connector.mapRow(makeLine({ timestamp: { value: 1 } }), makeCtx());
    assert.ok(result);
    assert.equal(result.ts, now);
  });

  it('handles numeric timestamp', () => {
    const connector = makeConnector();
    const ts = 1700000000000;
    const result = connector.mapRow(makeLine({ timestamp: ts }), makeCtx());
    assert.ok(result);
    assert.equal(result.ts, ts);
  });

  it('uses message-level timestamp when no top-level timestamp', () => {
    const connector = makeConnector();
    const row = {
      type: 'assistant',
      message: { model: 'claude-sonnet-4', usage: { input_tokens: 10, output_tokens: 5 }, timestamp: '2026-01-15T10:00:00.000Z' },
    };
    const result = connector.mapRow(row, makeCtx());
    assert.ok(result);
    assert.ok(result.ts > 0);
  });

  it('includes repo from ctx', () => {
    const connector = makeConnector();
    const result = connector.mapRow(makeLine({}), makeCtx({ repo: 'org/repo' }));
    assert.equal(result?.repo, 'org/repo');
  });

  it('includes branch from ctx', () => {
    const connector = makeConnector();
    const result = connector.mapRow(makeLine({}), makeCtx({ branch: 'main' }));
    assert.equal(result?.branch, 'main');
  });

  it('uses ctx.surface (agent) from context pre-scan', () => {
    const connector = makeConnector();
    const result = connector.mapRow(makeLine({}), makeCtx({ surface: 'agent' }));
    assert.equal(result?.surface, 'agent');
  });

  it('defaults surface to "agent" when ctx.surface is absent', () => {
    const connector = makeConnector();
    const result = connector.mapRow(makeLine({}), makeCtx());
    assert.equal(result?.surface, 'agent');
  });

  it('respects ctx.surface = "chat"', () => {
    const connector = makeConnector();
    const result = connector.mapRow(makeLine({}), makeCtx({ surface: 'chat' }));
    assert.equal(result?.surface, 'chat');
  });

  it('omits costByCategory when no token counts', () => {
    const connector = makeConnector();
    const row = { type: 'assistant', model: 'claude-sonnet-4', usage: {}, timestamp: '2026-01-15T10:00:00.000Z' };
    const result = connector.mapRow(row, makeCtx());
    assert.equal(result?.costByCategory, undefined);
  });

  it('omits costByCategory when model cost is zero', () => {
    const manifest = { version: 1 as const, pricePerCredit: 0.04, updatedAt: '2026-01-01', models: { 'claude-sonnet-4': 0 } };
    const connector = makeConnector();
    const result = connector.mapRow(
      { type: 'assistant', message: { model: 'claude-sonnet-4', usage: { input_tokens: 100, output_tokens: 50 } }, timestamp: '2026-01-15T10:00:00.000Z' },
      makeCtx({ manifest }),
    );
    assert.equal(result?.costByCategory, undefined);
  });

  it('converts string token values via num()', () => {
    const connector = makeConnector();
    const row = { type: 'assistant', message: { model: 'claude-sonnet-4', usage: { input_tokens: '100', output_tokens: '50' } }, timestamp: '2026-01-15T10:00:00.000Z' };
    const result = connector.mapRow(row, makeCtx());
    assert.equal(result?.promptTokens, 100);
    assert.equal(result?.completionTokens, 50);
  });

  it('rejects negative token counts — stored as undefined', () => {
    const connector = makeConnector();
    const row = { type: 'assistant', message: { model: 'claude-sonnet-4', usage: { input_tokens: -100, output_tokens: 50 } }, timestamp: '2026-01-15T10:00:00.000Z' };
    const result = connector.mapRow(row, makeCtx());
    assert.equal(result?.promptTokens, undefined);
    assert.equal(result?.completionTokens, 50);
  });

  it('parses cache_creation_input_tokens', () => {
    const connector = makeConnector();
    const row = { type: 'assistant', message: { model: 'claude-sonnet-4', usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 200 } }, timestamp: '2026-01-15T10:00:00.000Z' };
    const result = connector.mapRow(row, makeCtx());
    assert.equal(result?.cacheCreationTokens, 200);
  });

  it('parses cache_read_input_tokens', () => {
    const connector = makeConnector();
    const row = { type: 'assistant', message: { model: 'claude-sonnet-4', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 3000 } }, timestamp: '2026-01-15T10:00:00.000Z' };
    const result = connector.mapRow(row, makeCtx());
    assert.equal(result?.cacheReadTokens, 3000);
  });

  it('parses thinking_tokens', () => {
    const connector = makeConnector();
    const row = { type: 'assistant', message: { model: 'claude-sonnet-4', usage: { input_tokens: 100, output_tokens: 50, thinking_tokens: 80 } }, timestamp: '2026-01-15T10:00:00.000Z' };
    const result = connector.mapRow(row, makeCtx());
    assert.equal(result?.thinkingTokens, 80);
  });

  it('leaves cache/thinking tokens absent when not in usage', () => {
    const connector = makeConnector();
    const result = connector.mapRow(makeLine({}), makeCtx());
    assert.equal(result?.cacheCreationTokens, undefined);
    assert.equal(result?.cacheReadTokens, undefined);
    assert.equal(result?.thinkingTokens, undefined);
  });

  it('includes cache_creation in costByCategory when present', () => {
    const manifest = { version: 1 as const, pricePerCredit: 0.04, updatedAt: '2026-01-01', models: { 'claude-sonnet-4': 1 } };
    const connector = makeConnector();
    const row = { type: 'assistant', message: { model: 'claude-sonnet-4', usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 200 } }, timestamp: '2026-01-15T10:00:00.000Z' };
    const result = connector.mapRow(row, makeCtx({ manifest }));
    assert.ok(result?.costByCategory?.['cache_creation'] !== undefined);
    assert.ok(result?.costByCategory?.['input'] !== undefined);
  });

  it('includes cache_read in costByCategory when present', () => {
    const manifest = { version: 1 as const, pricePerCredit: 0.04, updatedAt: '2026-01-01', models: { 'claude-sonnet-4': 1 } };
    const connector = makeConnector();
    const row = { type: 'assistant', message: { model: 'claude-sonnet-4', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 3000 } }, timestamp: '2026-01-15T10:00:00.000Z' };
    const result = connector.mapRow(row, makeCtx({ manifest }));
    assert.ok(result?.costByCategory?.['cache_read'] !== undefined);
  });

  it('includes thinking in costByCategory when present', () => {
    const manifest = { version: 1 as const, pricePerCredit: 0.04, updatedAt: '2026-01-01', models: { 'claude-sonnet-4': 1 } };
    const connector = makeConnector();
    const row = { type: 'assistant', message: { model: 'claude-sonnet-4', usage: { input_tokens: 100, output_tokens: 50, thinking_tokens: 80 } }, timestamp: '2026-01-15T10:00:00.000Z' };
    const result = connector.mapRow(row, makeCtx({ manifest }));
    assert.ok(result?.costByCategory?.['thinking'] !== undefined);
  });

  it('applies manifest multiplier from ctx', () => {
    const manifest = { version: 1 as const, pricePerCredit: 0.04, updatedAt: '2026-01-01', models: { 'claude-sonnet-4': 2 } };
    const connector = makeConnector();
    const result = connector.mapRow(makeLine({}), makeCtx({ manifest }));
    assert.ok(result);
    assert.equal(result.credits, 2);
  });

  it('includes sessionId in event id for uniqueness', () => {
    const connector = makeConnector();
    const sessionId = 'abc12345-0000-0000-0000-deadbeef1234';
    const result = connector.mapRow(makeLine({ sessionId }), makeCtx());
    assert.ok(result);
    assert.ok(result.id.includes('ef1234:'), 'event id should include last 8 chars of sessionId');
  });

  it('falls back to "cc" in id when sessionId is absent', () => {
    const connector = makeConnector();
    const result = connector.mapRow(makeLine({}), makeCtx());
    assert.ok(result);
    assert.ok(result.id.startsWith('claude-code:cc:'));
  });

  it('covers splitCost when only output tokens exist', () => {
    const connector = makeConnector();
    const row = { type: 'assistant', message: { model: 'claude-sonnet-4', usage: { output_tokens: 50 } }, timestamp: '2026-01-15T10:00:00.000Z' };
    const result = connector.mapRow(row, makeCtx());
    assert.ok(result?.costByCategory?.['output'] !== undefined);
  });
});
