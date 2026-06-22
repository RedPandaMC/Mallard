import { strict as assert } from 'assert';
import * as path from 'path';
import { ClaudeCodeParser } from '../../../src/ingest/parsers/ClaudeCodeParser';
import { FolderLike } from '../../../src/ingest/LogParser';

function makeFolder(fsPath: string, index = 0): FolderLike {
  return { uri: { fsPath }, name: path.basename(fsPath), index };
}

describe('ClaudeCodeParser', () => {
  describe('sourceKind', () => {
    it('is "claude-code"', () => {
      const parser = new ClaudeCodeParser();
      assert.equal(parser.sourceKind, 'claude-code');
    });
  });

  describe('canParse()', () => {
    const parser = new ClaudeCodeParser();

    it('accepts .jsonl files under a .claude path', () => {
      assert.ok(parser.canParse('/home/user/.claude/projects/abc123/session.jsonl'));
    });

    it('rejects .jsonl files not under a .claude path', () => {
      assert.ok(!parser.canParse('/tmp/some-other/file.jsonl'));
    });

    it('rejects .log files even under .claude', () => {
      assert.ok(!parser.canParse('/home/user/.claude/projects/abc/output.log'));
    });

    it('rejects Copilot OTel .json files', () => {
      assert.ok(!parser.canParse('/logs/copilot.otel.json'));
    });
  });

  describe('resolveWorkspace()', () => {
    it('returns undefined when no folders are provided', () => {
      const parser = new ClaudeCodeParser();
      const result = parser.resolveWorkspace('/home/user/.claude/projects/abc/session.jsonl');
      assert.equal(result, undefined);
    });

    it('returns undefined when no folders match', () => {
      const parser = new ClaudeCodeParser(() => [makeFolder('/home/user/other-project')]);
      const result = parser.resolveWorkspace('/home/user/.claude/projects/abc/session.jsonl');
      assert.equal(result, undefined);
    });

    it('returns the matching folder when the hash matches the workspace path', () => {
      const workspacePath = '/home/user/Mallard';
      // Compute the hash Claude Code uses
      const expectedHash = encodeURIComponent(workspacePath).replace(/%/g, '').toLowerCase();
      const filePath = `/home/user/.claude/projects/${expectedHash}/session.jsonl`;

      const folder = makeFolder(workspacePath);
      const parser = new ClaudeCodeParser(() => [folder]);
      const result = parser.resolveWorkspace(filePath);
      assert.deepEqual(result, folder);
    });

    it('matches the correct folder among multiple workspace folders', () => {
      const wsA = '/home/user/project-a';
      const wsB = '/home/user/project-b';
      const hashB = encodeURIComponent(wsB).replace(/%/g, '').toLowerCase();
      const filePath = `/home/user/.claude/projects/${hashB}/session.jsonl`;

      const folderA = makeFolder(wsA, 0);
      const folderB = makeFolder(wsB, 1);
      const parser = new ClaudeCodeParser(() => [folderA, folderB]);
      const result = parser.resolveWorkspace(filePath);
      assert.deepEqual(result, folderB);
    });

    it('returns undefined when the path has no "projects" segment', () => {
      const parser = new ClaudeCodeParser(() => [makeFolder('/home/user/project')]);
      const result = parser.resolveWorkspace('/home/user/.claude/session.jsonl');
      assert.equal(result, undefined);
    });
  });

  describe('parse()', () => {
    const now = new Date('2026-01-15T10:00:00.000Z').getTime();
    const parser = new ClaudeCodeParser();

    function makeLine(overrides: Record<string, unknown>) {
      return JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-sonnet-4', usage: { input_tokens: 100, output_tokens: 50 } },
        timestamp: '2026-01-15T10:00:00.000Z',
        ...overrides,
      });
    }

    it('returns events for valid assistant turns', () => {
      const events = parser.parse(makeLine({}), { pricePerCredit: 0.04, now });
      assert.equal(events.length, 1);
      assert.equal(events[0]!.modelId, 'claude-sonnet-4');
      assert.equal(events[0]!.source, 'claude-code');
    });

    it('uses ctx.fileKey when provided', () => {
      const events = parser.parse(makeLine({}), { pricePerCredit: 0.04, now, fileKey: 'ck' });
      assert.ok(events[0]!.id.startsWith('claude-code:ck:'));
    });

    it('applies ctx.baseOffset to event id', () => {
      const events = parser.parse(makeLine({}), { pricePerCredit: 0.04, now, baseOffset: 50 });
      assert.ok(events[0]!.id.endsWith(':50'));
    });

    it('uses top-level rec.usage when usage is not inside message', () => {
      const line = JSON.stringify({
        type: 'assistant',
        model: 'claude-haiku-4',
        usage: { input_tokens: 80, output_tokens: 40 },
        timestamp: '2026-01-15T10:00:00.000Z',
      });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events.length, 1);
      assert.equal(events[0]!.modelId, 'claude-haiku-4');
    });

    it('uses model from rec level when not in message', () => {
      const line = JSON.stringify({
        type: 'assistant',
        model: 'claude-opus-4',
        message: { usage: { input_tokens: 10, output_tokens: 5 } },
        timestamp: '2026-01-15T10:00:00.000Z',
      });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events[0]!.modelId, 'claude-opus-4');
    });

    it('handles numeric timestamp', () => {
      const ts = 1700000000000;
      const line = JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-sonnet-4', usage: { input_tokens: 10, output_tokens: 5 } },
        timestamp: ts,
      });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events[0]!.ts, ts);
    });

    it('falls back to ctx.now for NaN timestamp', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-sonnet-4', usage: { input_tokens: 10, output_tokens: 5 } },
        timestamp: 'garbage',
      });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events[0]!.ts, now);
    });

    it('includes repo from ctx', () => {
      const events = parser.parse(makeLine({}), { pricePerCredit: 0.04, now, repo: 'org/repo' });
      assert.equal(events[0]!.repo, 'org/repo');
    });

    it('includes branch from ctx', () => {
      const events = parser.parse(makeLine({}), { pricePerCredit: 0.04, now, branch: 'main' });
      assert.equal(events[0]!.branch, 'main');
    });

    it('omits costByCategory when no token counts', () => {
      const line = JSON.stringify({
        type: 'assistant',
        model: 'claude-sonnet-4',
        usage: {},
        timestamp: '2026-01-15T10:00:00.000Z',
      });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events[0]!.costByCategory, undefined);
    });

    it('converts string input_tokens via num()', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-sonnet-4', usage: { input_tokens: '100', output_tokens: '50' } },
        timestamp: '2026-01-15T10:00:00.000Z',
      });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events[0]!.promptTokens, 100);
      assert.equal(events[0]!.completionTokens, 50);
    });

    it('skips non-assistant lines', () => {
      const line = JSON.stringify({ type: 'user', message: 'hello' });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events.length, 0);
    });

    it('skips invalid JSON lines and still parses valid ones', () => {
      const validLine = makeLine({});
      const content = `{broken json\n${validLine}`;
      const events = parser.parse(content, { pricePerCredit: 0.04, now });
      assert.equal(events.length, 1);
    });

    it('skips empty lines and lines not starting with {', () => {
      const validLine = makeLine({});
      const content = `\nnot-json-here\n${validLine}`;
      const events = parser.parse(content, { pricePerCredit: 0.04, now });
      assert.equal(events.length, 1);
    });

    it('skips assistant lines with no usage anywhere', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: { model: 'gpt-4o' },
        timestamp: '2026-01-15T10:00:00.000Z',
      });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events.length, 0);
    });

    it('skips assistant lines with usage but no model attribute', () => {
      const line = JSON.stringify({
        type: 'assistant',
        usage: { input_tokens: 10, output_tokens: 5 },
        timestamp: '2026-01-15T10:00:00.000Z',
      });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events.length, 0);
    });

    it('uses message-level timestamp when rec has no top-level timestamp or time', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-sonnet-4', usage: { input_tokens: 10, output_tokens: 5 }, timestamp: '2026-01-15T10:00:00.000Z' },
      });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events.length, 1);
      assert.ok(events[0]!.ts > 0);
    });

    it('includes manifest from ctx when provided', () => {
      const manifest = { version: 1 as const, pricePerCredit: 0.04, updatedAt: '2026-01-01', models: { 'claude-sonnet-4': 2 } };
      const events = parser.parse(makeLine({}), { pricePerCredit: 0.04, now, manifest });
      assert.equal(events.length, 1);
      assert.equal(events[0]!.credits, 2);
    });

    it('covers prompt ?? 0 in splitCost when only completion tokens exist', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-sonnet-4', usage: { output_tokens: 50 } },
        timestamp: '2026-01-15T10:00:00.000Z',
      });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events.length, 1);
      assert.ok(events[0]!.costByCategory !== undefined);
      assert.ok(events[0]!.costByCategory!['output'] !== undefined);
    });

    it('uses ctx.now when timestamp is an object (neither string nor number)', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-sonnet-4', usage: { input_tokens: 10, output_tokens: 5 } },
        timestamp: { value: 1 },
      });
      const events = parser.parse(line, { pricePerCredit: 0.04, now });
      assert.equal(events[0]!.ts, now);
    });
  });

  describe('resolveWorkspace() — projIdx >= parts.length', () => {
    it('returns undefined when path ends exactly at "projects" with no hash segment', () => {
      const parser = new ClaudeCodeParser(() => [makeFolder('/home/user/project')]);
      // path.sep-split of '/home/user/.claude/projects' gives [..., 'projects'] as last element
      const result = parser.resolveWorkspace(`${path.sep}home${path.sep}user${path.sep}.claude${path.sep}projects`);
      assert.equal(result, undefined);
    });
  });
});
