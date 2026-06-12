import * as assert from 'assert';
import { parseOtelContent } from '../../src/data/providers/logparse/otelParse';
import { ProviderContext } from '../../src/data/UsageProvider';

const ctx: ProviderContext = {
  pricePerCredit: 0.04,
  currency: 'USD',
  now: 1_700_000_000_000,
};

describe('parseOtelContent', () => {
  it('parses OTel-style attribute records into events', () => {
    const content = [
      JSON.stringify({
        timestamp: '2026-01-15T10:00:00.000Z',
        attributes: {
          'gen_ai.request.model': 'gpt-4o',
          'gen_ai.usage.input_tokens': 1200,
          'gen_ai.usage.output_tokens': 300,
          'gen_ai.operation.surface': 'chat',
        },
      }),
    ].join('\n');

    const events = parseOtelContent(content, ctx);
    assert.strictEqual(events.length, 1);
    const e = events[0];
    assert.strictEqual(e.modelId, 'gpt-4o');
    assert.strictEqual(e.promptTokens, 1200);
    assert.strictEqual(e.completionTokens, 300);
    assert.strictEqual(e.surface, 'chat');
    assert.strictEqual(e.source, 'local');
    assert.strictEqual(e.estimated, true);
    assert.strictEqual(e.ts, Date.parse('2026-01-15T10:00:00.000Z'));
  });

  it('accepts flat (non-nested) records and alternate token keys', () => {
    const content = JSON.stringify({
      time: 1_700_000_500_000,
      model: 'claude-sonnet-4',
      input_tokens: '500',
      output_tokens: '120',
      surface: 'inline-completion',
    });
    const events = parseOtelContent(content, ctx);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].modelId, 'claude-sonnet-4');
    assert.strictEqual(events[0].promptTokens, 500);
    assert.strictEqual(events[0].completionTokens, 120);
    assert.strictEqual(events[0].surface, 'inline');
    assert.strictEqual(events[0].ts, 1_700_000_500_000);
  });

  it('skips malformed lines and non-JSON noise', () => {
    const content = [
      'this is a log preamble, not json',
      '{ broken json',
      '',
      '   ',
      JSON.stringify({ model: 'gpt-4o', input_tokens: 10 }),
      'INFO: shutting down',
    ].join('\n');
    const events = parseOtelContent(content, ctx);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].modelId, 'gpt-4o');
  });

  it('ignores records without a model', () => {
    const content = [
      JSON.stringify({ attributes: { 'gen_ai.usage.input_tokens': 100 } }),
      JSON.stringify({ foo: 'bar' }),
    ].join('\n');
    assert.strictEqual(parseOtelContent(content, ctx).length, 0);
  });

  it('falls back to ctx.now when timestamp is missing or invalid', () => {
    const content = JSON.stringify({ model: 'gpt-4o', timestamp: 'not-a-date' });
    const events = parseOtelContent(content, ctx);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].ts, ctx.now);
  });

  it('produces stable, unique ids per record', () => {
    const content = [
      JSON.stringify({ model: 'gpt-4o', timestamp: 1000 }),
      JSON.stringify({ model: 'gpt-4o', timestamp: 1000 }),
    ].join('\n');
    const events = parseOtelContent(content, ctx);
    assert.strictEqual(events.length, 2);
    assert.notStrictEqual(events[0].id, events[1].id);
  });

  it('returns an empty array for empty content', () => {
    assert.deepStrictEqual(parseOtelContent('', ctx), []);
  });
});
