import { strict as assert } from 'assert';
import { LogParserRegistry } from '../../src/ingest/LogParserRegistry';
import { LogParser, FolderLike } from '../../src/ingest/LogParser';
import { SourceKind, UsageEvent } from '../../src/domain/types';
import { ParseContext } from '../../src/ingest/otelParse';

function makeParser(sourceKind: SourceKind, ext: string): LogParser {
  return {
    sourceKind,
    canParse: (fp) => fp.endsWith(ext),
    resolveWorkspace: (_fp): FolderLike | undefined => undefined,
    parse: (_content: string, _ctx: ParseContext): UsageEvent[] => [],
  };
}

describe('LogParserRegistry', () => {
  it('returns undefined when no parsers are registered', () => {
    const reg = new LogParserRegistry();
    assert.equal(reg.forFile('/logs/copilot.log'), undefined);
  });

  it('returns undefined when no parser matches', () => {
    const reg = new LogParserRegistry();
    reg.register(makeParser('local', '.log'));
    assert.equal(reg.forFile('/logs/file.json'), undefined);
  });

  it('returns the first parser whose canParse() returns true', () => {
    const reg = new LogParserRegistry();
    const p1 = makeParser('local', '.log');
    const p2 = makeParser('claude-code', '.jsonl');
    reg.register(p1);
    reg.register(p2);
    assert.strictEqual(reg.forFile('/logs/copilot.log'), p1);
    assert.strictEqual(reg.forFile('/home/user/.claude/session.jsonl'), p2);
  });

  it('earlier registrations take priority when multiple parsers match', () => {
    const reg = new LogParserRegistry();
    const p1 = makeParser('local', '.log');
    const p2: LogParser = { ...makeParser('lm', '.log'), sourceKind: 'lm' };
    reg.register(p1);
    reg.register(p2);
    assert.strictEqual(reg.forFile('/logs/copilot.log'), p1);
  });

  it('registeredSources() returns source kinds in registration order', () => {
    const reg = new LogParserRegistry();
    reg.register(makeParser('local', '.log'));
    reg.register(makeParser('claude-code', '.jsonl'));
    assert.deepEqual(reg.registeredSources(), ['local', 'claude-code']);
  });
});
