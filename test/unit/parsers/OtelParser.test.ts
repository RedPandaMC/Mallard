import { strict as assert } from 'assert';
import { OtelParser } from '../../../src/ingest/parsers/OtelParser';

const parser = new OtelParser();

describe('OtelParser', () => {
  describe('sourceKind', () => {
    it('is "local"', () => {
      assert.equal(parser.sourceKind, 'local');
    });
  });

  describe('canParse()', () => {
    it('accepts .log files containing "copilot"', () => {
      assert.ok(parser.canParse('/logs/github.copilot-chat.log'));
    });

    it('accepts .json files containing "copilot"', () => {
      assert.ok(parser.canParse('/logs/copilot.json'));
    });

    it('accepts .ndjson files containing "copilot"', () => {
      assert.ok(parser.canParse('/logs/copilot.ndjson'));
    });

    it('accepts .otel.json files containing "copilot"', () => {
      assert.ok(parser.canParse('/logs/copilot.otel.json'));
    });

    it('rejects .jsonl files (Claude Code format)', () => {
      assert.ok(!parser.canParse('/home/user/.claude/projects/abc/session.jsonl'));
    });

    it('rejects files without "copilot" in the name', () => {
      assert.ok(!parser.canParse('/logs/github.extension.log'));
      assert.ok(!parser.canParse('/logs/model.json'));
    });
  });

  describe('resolveWorkspace()', () => {
    it('always returns undefined (user-level logs)', () => {
      assert.equal(parser.resolveWorkspace('/logs/copilot.log'), undefined);
      assert.equal(parser.resolveWorkspace('/any/path'), undefined);
    });
  });

  describe('parse()', () => {
    const baseAttrs = {
      'gen_ai.request.model': 'gpt-4o',
      'gen_ai.usage.input_tokens': 100,
      'gen_ai.usage.output_tokens': 50,
    };
    const now = new Date('2026-01-15T10:00:00.000Z').getTime();

    it('delegates to parseOtelContent — returns events for valid OTel records', () => {
      const line = JSON.stringify({ timestamp: '2026-01-15T10:00:00.000Z', attributes: baseAttrs });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events.length, 1);
      assert.equal(events[0]!.modelId, 'gpt-4o');
      assert.equal(events[0]!.source, 'local');
    });

    it('toSurface — inline/completion', () => {
      const line = JSON.stringify({ timestamp: '2026-01-15T10:00:00.000Z', attributes: { ...baseAttrs, 'gen_ai.operation.surface': 'completion' } });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events[0]!.surface, 'inline');
    });

    it('toSurface — agent', () => {
      const line = JSON.stringify({ timestamp: '2026-01-15T10:00:00.000Z', attributes: { ...baseAttrs, 'gen_ai.operation.surface': 'agent' } });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events[0]!.surface, 'agent');
    });

    it('toSurface — edit', () => {
      const line = JSON.stringify({ timestamp: '2026-01-15T10:00:00.000Z', attributes: { ...baseAttrs, 'gen_ai.operation.surface': 'edit' } });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events[0]!.surface, 'edit');
    });

    it('toSurface — chat', () => {
      const line = JSON.stringify({ timestamp: '2026-01-15T10:00:00.000Z', attributes: { ...baseAttrs, 'gen_ai.operation.surface': 'chat' } });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events[0]!.surface, 'chat');
    });

    it('toSurface — unknown fallback', () => {
      const line = JSON.stringify({ timestamp: '2026-01-15T10:00:00.000Z', attributes: { ...baseAttrs, 'gen_ai.operation.surface': 'something_new' } });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events[0]!.surface, 'unknown');
    });

    it('uses numeric timestamp directly', () => {
      const ts = 1700000000000;
      const line = JSON.stringify({ timestamp: ts, attributes: baseAttrs });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events[0]!.ts, ts);
    });

    it('falls back to ctx.now for NaN timestamp', () => {
      const line = JSON.stringify({ timestamp: 'not-a-date', attributes: baseAttrs });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events[0]!.ts, now);
    });

    it('falls back to ctx.now when timestamp is an object (neither string nor number)', () => {
      const line = JSON.stringify({ timestamp: { value: 1 }, attributes: baseAttrs });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events[0]!.ts, now);
    });

    it('includes repo from ctx when provided', () => {
      const line = JSON.stringify({ timestamp: '2026-01-15T10:00:00.000Z', attributes: baseAttrs });
      const events = parser.parse(line, { pricePerCredit: 0.04, now, repo: 'org/repo' });
      assert.equal(events[0]!.repo, 'org/repo');
    });

    it('includes branch from ctx when provided', () => {
      const line = JSON.stringify({ timestamp: '2026-01-15T10:00:00.000Z', attributes: baseAttrs });
      const events = parser.parse(line, { pricePerCredit: 0.04, now, branch: 'main' });
      assert.equal(events[0]!.branch, 'main');
    });

    it('omits costByCategory when totalTok is 0 (no token fields)', () => {
      const line = JSON.stringify({ timestamp: '2026-01-15T10:00:00.000Z', attributes: { 'gen_ai.request.model': 'gpt-4o' } });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events[0]!.costByCategory, undefined);
    });

    it('uses rec-level attributes when rec.attributes is absent', () => {
      const line = JSON.stringify({ timestamp: '2026-01-15T10:00:00.000Z', 'gen_ai.request.model': 'gpt-4o' });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events[0]!.modelId, 'gpt-4o');
    });

    it('uses ctx.fileKey when provided', () => {
      const line = JSON.stringify({ timestamp: '2026-01-15T10:00:00.000Z', attributes: baseAttrs });
      const events = parser.parse(line, { pricePerCredit: 0.04, now, fileKey: 'mykey' });
      assert.ok(events[0]!.id.startsWith('local:mykey:'));
    });

    it('applies ctx.baseOffset to event id', () => {
      const line = JSON.stringify({ timestamp: '2026-01-15T10:00:00.000Z', attributes: baseAttrs });
      const events = parser.parse(line, { pricePerCredit: 0.04, now, baseOffset: 100 });
      assert.ok(events[0]!.id.endsWith(':100'));
    });

    it('skips non-JSON lines', () => {
      const validLine = JSON.stringify({ timestamp: '2026-01-15T10:00:00.000Z', attributes: baseAttrs });
      const content = `not json at all\n${validLine}`;
      const events = parser.parse(content, { pricePerCredit: 0.04, now });
      assert.equal(events.length, 1);
    });

    it('skips lines with invalid JSON (parse failure)', () => {
      const validLine = JSON.stringify({ timestamp: '2026-01-15T10:00:00.000Z', attributes: baseAttrs });
      const content = `{broken json\n${validLine}`;
      const events = parser.parse(content, { pricePerCredit: 0.04, now });
      assert.equal(events.length, 1);
    });

    it('skips lines starting with [ that have no model attribute', () => {
      const validLine = JSON.stringify({ timestamp: '2026-01-15T10:00:00.000Z', attributes: baseAttrs });
      const content = `[]\n${validLine}`;
      const events = parser.parse(content, { pricePerCredit: 0.04, now });
      assert.equal(events.length, 1);
    });

    it('parses string token values via num()', () => {
      const line = JSON.stringify({
        timestamp: '2026-01-15T10:00:00.000Z',
        attributes: { 'gen_ai.request.model': 'gpt-4o', 'gen_ai.usage.input_tokens': '100', 'gen_ai.usage.output_tokens': '50' },
      });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events.length, 1);
      assert.equal(events[0]!.promptTokens, 100);
      assert.equal(events[0]!.completionTokens, 50);
    });

    it('falls back to attrs.timestamp when rec has no top-level timestamp/time', () => {
      const line = JSON.stringify({
        attributes: { 'gen_ai.request.model': 'gpt-4o', timestamp: '2026-01-15T10:00:00.000Z', ...baseAttrs },
      });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events.length, 1);
      assert.ok(events[0]!.ts > 0);
    });

    it('passes manifest from ctx to priceRequest', () => {
      const manifest = { version: 1, pricePerCredit: 0.05, updatedAt: '2026-01-01', models: { 'gpt-4o': 3, unknown: 1 } };
      const line = JSON.stringify({ timestamp: '2026-01-15T10:00:00.000Z', attributes: baseAttrs });
      const events = parser.parse(line, { pricePerCredit: 0.04, now, manifest });
      assert.equal(events.length, 1);
      assert.equal(events[0]!.credits, 3); // manifest multiplier applied
    });

    it('omits costByCategory for a free model (cost = 0)', () => {
      const line = JSON.stringify({
        timestamp: '2026-01-15T10:00:00.000Z',
        attributes: { 'gen_ai.request.model': 'gpt-4o-mini', 'gen_ai.usage.input_tokens': 100, 'gen_ai.usage.output_tokens': 50 },
      });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events.length, 1);
      assert.equal(events[0]!.costByCategory, undefined); // cost=0, so undefined
    });

    it('rejects negative token counts — stored as undefined, not negative', () => {
      const line = JSON.stringify({
        timestamp: '2026-01-15T10:00:00.000Z',
        attributes: {
          'gen_ai.request.model': 'gpt-4o',
          'gen_ai.usage.input_tokens': -100,
          'gen_ai.usage.output_tokens': 50,
        },
      });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events.length, 1);
      assert.equal(events[0]!.promptTokens, undefined); // negative rejected
      assert.equal(events[0]!.completionTokens, 50);    // positive kept
    });

    it('covers prompt ?? 0 in splitCost when only completion tokens exist', () => {
      const line = JSON.stringify({
        timestamp: '2026-01-15T10:00:00.000Z',
        attributes: { 'gen_ai.request.model': 'gpt-4o', 'gen_ai.usage.output_tokens': 50 },
      });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events.length, 1);
      assert.ok(events[0]!.costByCategory !== undefined);
      assert.ok(events[0]!.costByCategory!['output'] !== undefined);
    });
  });
});
