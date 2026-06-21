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
    it('delegates to parseClaudeCodeContent — returns events for valid assistant turns', () => {
      const parser = new ClaudeCodeParser();
      const line = JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-sonnet-4', usage: { input_tokens: 100, output_tokens: 50 } },
        timestamp: '2026-01-15T10:00:00.000Z',
      });
      const events = parser.parse(line, { pricePerCredit: 0.04, now: Date.now() });
      assert.equal(events.length, 1);
      assert.equal(events[0]!.modelId, 'claude-sonnet-4');
      assert.equal(events[0]!.source, 'claude-code');
    });
  });
});
