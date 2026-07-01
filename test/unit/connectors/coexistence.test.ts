/**
 * Both Copilot and Claude Code connectors can be registered and run at once
 * (the extension does this by default via ConnectorRegistry in container.ts).
 * These tests confirm the two don't collide on identity — watermark keys,
 * event ids, or `source` tagging — and that a snapshot built from events
 * produced by both aggregates them correctly rather than one clobbering the
 * other.
 */
import { strict as assert } from 'assert';
import { CopilotConnector } from '../../../src/extension-backend/ingest/CopilotConnector';
import { ClaudeCodeConnector } from '../../../src/extension-backend/ingest/ClaudeCodeConnector';
import { ConnectorRegistry } from '../../../src/extension-backend/ingest/ConnectorRegistry';
import type { IWorkspaceFolderMatcher } from '../../../src/extension-backend/ingest/WorkspaceFolderMatcher';
import type { ParseContext } from '../../../src/extension-backend/ingest/otelParse';
import type { PricingService } from '../../../src/extension-backend/pricing/PricingService';
import type { IMetaStore as MetaStore } from '../../../src/extension-backend/store/MetaStore';
import type { DuckDBFileReader } from '../../../src/extension-backend/store/DuckDBFileReader';
import { buildSnapshot, SnapshotOptions } from '../../../src/extension-backend/domain/snapshot';

const now = new Date('2026-01-15T10:00:00.000Z').getTime();
const noopMatcher: IWorkspaceFolderMatcher = { resolve: () => undefined };

function makePricing(): PricingService {
  return { pricePerCredit: 0.04, currentManifest: undefined } as unknown as PricingService;
}

function makeMeta(store: Map<string, string>): MetaStore {
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as MetaStore;
}

function makeCtx(overrides?: Partial<ParseContext>): ParseContext {
  return { pricePerCredit: 0.04, now, ...overrides };
}

function opts(over: Partial<SnapshotOptions> = {}): SnapshotOptions {
  return {
    now,
    currency: 'USD',
    pricePerCredit: 0.04,
    monthlyBudget: null,
    includedCredits: 300,
    filter: {},
    source: 'local',
    status: { kind: 'ok' },
    authStatus: 'signed-out',
    ...over,
  };
}

describe('Copilot + Claude Code connector coexistence', () => {
  it('use distinct connector ids and watermark keys even when sharing one MetaStore', async () => {
    const metaStore = new Map<string, string>();
    const meta = makeMeta(metaStore);
    const copilot = new CopilotConnector(makePricing(), meta, {} as DuckDBFileReader);
    const claudeCode = new ClaudeCodeConnector(makePricing(), meta, {} as DuckDBFileReader, noopMatcher);

    assert.notEqual(copilot.id, claudeCode.id);

    const copilotKey = (copilot as unknown as { watermarkKey: string }).watermarkKey;
    const claudeKey = (claudeCode as unknown as { watermarkKey: string }).watermarkKey;
    assert.notEqual(copilotKey, claudeKey);

    // Writing a watermark for one connector must not be visible to the other,
    // since both would otherwise think their logs were already fully read.
    await meta.set(copilotKey, '1000');
    assert.equal(await meta.get(claudeKey), null);
    assert.equal(await meta.get(copilotKey), '1000');
  });

  it('ConnectorRegistry holds both without one replacing the other', () => {
    const meta = makeMeta(new Map());
    const copilot = new CopilotConnector(makePricing(), meta, {} as DuckDBFileReader);
    const claudeCode = new ClaudeCodeConnector(makePricing(), meta, {} as DuckDBFileReader, noopMatcher);

    const registry = new ConnectorRegistry().register(copilot).register(claudeCode).build();

    assert.equal(registry.length, 2);
    assert.deepEqual(registry.map((c) => c.id).sort(), ['claude-code', 'copilot']);
  });

  it('events mapped by each connector carry distinct source values and ids', () => {
    const meta = makeMeta(new Map());
    const copilot = new CopilotConnector(makePricing(), meta, {} as DuckDBFileReader);
    const claudeCode = new ClaudeCodeConnector(makePricing(), meta, {} as DuckDBFileReader, noopMatcher);

    const copilotEvent = copilot.mapRow(
      {
        timestamp: '2026-01-15T10:00:00.000Z',
        attributes: {
          'gen_ai.request.model': 'gpt-4o',
          'gen_ai.usage.input_tokens': 100,
          'gen_ai.usage.output_tokens': 50,
        },
      },
      makeCtx(),
    );
    const claudeEvent = claudeCode.mapRow(
      {
        type: 'assistant',
        message: { model: 'claude-sonnet-4', usage: { input_tokens: 200, output_tokens: 80 } },
        timestamp: '2026-01-15T10:01:00.000Z',
      },
      makeCtx(),
    );

    assert.ok(copilotEvent);
    assert.ok(claudeEvent);
    assert.equal(copilotEvent.source, 'local');
    assert.equal(claudeEvent.source, 'claude-code');
    assert.notEqual(copilotEvent.id, claudeEvent.id);
  });

  it('a snapshot built from both connectors\' events aggregates each source correctly, not clobbered by the other', () => {
    const meta = makeMeta(new Map());
    const copilot = new CopilotConnector(makePricing(), meta, {} as DuckDBFileReader);
    const claudeCode = new ClaudeCodeConnector(makePricing(), meta, {} as DuckDBFileReader, noopMatcher);

    const copilotEvent = copilot.mapRow(
      {
        timestamp: '2026-01-15T10:00:00.000Z',
        attributes: {
          'gen_ai.request.model': 'gpt-4o',
          'gen_ai.usage.input_tokens': 100,
          'gen_ai.usage.output_tokens': 50,
        },
      },
      makeCtx(),
    )!;
    const claudeEvent = claudeCode.mapRow(
      {
        type: 'assistant',
        message: { model: 'claude-sonnet-4', usage: { input_tokens: 200, output_tokens: 80 } },
        timestamp: '2026-01-15T10:01:00.000Z',
      },
      makeCtx(),
    )!;

    const events = [copilotEvent, claudeEvent];
    const snap = buildSnapshot(events, { ...opts(), dimensionEvents: events });

    // Both sources present, neither one overwrites the other.
    assert.deepEqual(new Set(snap.allSources), new Set(['local', 'claude-code']));
    // Both models present in the same window.
    assert.deepEqual(new Set(snap.allModels), new Set(['gpt-4o', 'claude-sonnet-4']));
    // Total today credits is the sum of both connectors' events, not just one.
    const expectedTotalCredits = copilotEvent.credits + claudeEvent.credits;
    assert.ok(Math.abs(snap.today.credits - expectedTotalCredits) < 1e-9);
  });
});
