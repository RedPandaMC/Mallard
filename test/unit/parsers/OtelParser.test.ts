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
    it('delegates to parseOtelContent — returns events for valid OTel records', () => {
      const line = JSON.stringify({
        timestamp: '2026-01-15T10:00:00.000Z',
        attributes: {
          'gen_ai.request.model': 'gpt-4o',
          'gen_ai.usage.input_tokens': 100,
          'gen_ai.usage.output_tokens': 50,
        },
      });
      const events = parser.parse(line, { pricePerCredit: 0.04, now: Date.now() });
      assert.equal(events.length, 1);
      assert.equal(events[0]!.modelId, 'gpt-4o');
      assert.equal(events[0]!.source, 'local');
    });
  });
});
