import * as assert from 'assert';
import { parseIntent } from '../../src/chat/intent';

describe('parseIntent', () => {
  it('honours an explicit slash command over NL parsing', () => {
    assert.strictEqual(parseIntent('whatever the text says', 'forecast').kind, 'forecast');
    assert.strictEqual(parseIntent('', 'models').kind, 'models');
    assert.strictEqual(parseIntent('', 'repos').kind, 'repos');
    assert.strictEqual(parseIntent('', 'tips').kind, 'tips');
    assert.strictEqual(parseIntent('', 'today').kind, 'today');
  });

  it('ignores an unknown command and falls back to NL', () => {
    assert.strictEqual(parseIntent('how much today', 'bogus').kind, 'today');
  });

  it('detects forecast phrasings', () => {
    for (const p of [
      'what will I spend this month',
      'forecast my usage',
      'project month-end cost',
      'how much for the rest of the month',
    ]) {
      assert.strictEqual(parseIntent(p).kind, 'forecast', p);
    }
  });

  it('detects model-breakdown phrasings', () => {
    for (const p of ['which model costs most', 'break down by model', 'per model usage', 'show models']) {
      assert.strictEqual(parseIntent(p).kind, 'models', p);
    }
  });

  it('detects repo-breakdown phrasings', () => {
    for (const p of ['by repo please', 'which repository', 'per repo costs', 'show repos']) {
      assert.strictEqual(parseIntent(p).kind, 'repos', p);
    }
  });

  it('detects tips phrasings', () => {
    for (const p of ['any tips', 'how do I save money', 'make it cheaper', 'spend less']) {
      assert.strictEqual(parseIntent(p).kind, 'tips', p);
    }
  });

  it('detects today phrasings', () => {
    assert.strictEqual(parseIntent('what have I spent today').kind, 'today');
    assert.strictEqual(parseIntent('usage so far').kind, 'today');
  });

  it('falls back to summary for generic prompts', () => {
    assert.strictEqual(parseIntent('hello weevil').kind, 'summary');
    assert.strictEqual(parseIntent('').kind, 'summary');
  });

  it('extracts the requested metric', () => {
    assert.strictEqual(parseIntent('how many tokens today').metric, 'tokens');
    assert.strictEqual(parseIntent('how many credits today').metric, 'credits');
    assert.strictEqual(parseIntent('premium requests today').metric, 'credits');
    assert.strictEqual(parseIntent('how much money today').metric, 'cost');
    assert.strictEqual(parseIntent('today').metric, 'cost'); // default
  });

  it('extracts the requested granularity', () => {
    assert.strictEqual(parseIntent('hourly usage').granularity, 'hour');
    assert.strictEqual(parseIntent('this week').granularity, 'week');
    assert.strictEqual(parseIntent('quarterly view').granularity, 'quarter');
    assert.strictEqual(parseIntent('this year').granularity, 'year');
    assert.strictEqual(parseIntent('per month spend').granularity, 'month');
    assert.strictEqual(parseIntent('today').granularity, 'day'); // default
  });
});
