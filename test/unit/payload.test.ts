import { strict as assert } from 'assert';
import {
  buildStreamBatch,
  chunkEvents,
  STREAM_BATCH_MAX_EVENTS,
  toStreamEvent,
} from '../../src/extension-backend/export/payload';
import { makeEvent } from './helpers';

describe('toStreamEvent', () => {
  it('maps a priced, labeled UsageEvent to the wire shape', () => {
    const e = makeEvent({
      id: 'ev-1', ts: 1_700_000_000_000, modelId: 'gpt-4o', surface: 'chat',
      source: 'local', credits: 5, cost: 0.2, estimated: true,
      promptTokens: 100, completionTokens: 40,
      costByCategory: { input: 0.12, output: 0.08 },
      language: 'typescript',
    });
    assert.deepEqual(toStreamEvent(e), {
      id: 'ev-1', ts: 1_700_000_000_000, connector: 'local', model: 'gpt-4o',
      surface: 'chat', credits: 5, cost_usd: 0.2, estimated: true,
      prompt_tokens: 100, completion_tokens: 40,
      cost_by_category: { input: 0.12, output: 0.08 },
      language: 'typescript',
    });
  });

  it('exports edge-calculated repo, branch, and attribution when present', () => {
    const e = makeEvent({
      ts: 1, repo: 'org/app', branch: 'feature/x', attribution: 'heuristic',
    });
    const wire = toStreamEvent(e) as unknown as Record<string, unknown>;
    assert.equal(wire['repo'], 'org/app');
    assert.equal(wire['branch'], 'feature/x');
    assert.equal(wire['attribution'], 'heuristic');
  });

  it('omits optional fields that are absent instead of sending zeros', () => {
    const wire = toStreamEvent(makeEvent({ ts: 1 })) as unknown as Record<string, unknown>;
    for (const k of ['prompt_tokens', 'completion_tokens', 'cache_creation_tokens',
                     'cache_read_tokens', 'thinking_tokens', 'cost_by_category', 'language',
                     'repo', 'branch', 'attribution']) {
      assert.equal(k in wire, false, k);
    }
  });
});

describe('buildStreamBatch', () => {
  it('wraps events in a v1 envelope with instance hash and send time', () => {
    const before = Date.now();
    const batch = buildStreamBatch([makeEvent({ ts: 1 }), makeEvent({ ts: 2 })]);
    assert.equal(batch.schema_version, 1);
    assert.match(batch.instance_id, /^[0-9a-f]{64}$/);
    assert.ok(batch.sent_at >= before);
    assert.equal(batch.tz_offset_minutes, -new Date().getTimezoneOffset());
    assert.equal(batch.events.length, 2);
  });
});

describe('chunkEvents', () => {
  it('splits into wire-sized chunks, oldest first', () => {
    const events = Array.from({ length: STREAM_BATCH_MAX_EVENTS + 5 }, (_, i) =>
      makeEvent({ id: `e${i}`, ts: 1000 - i }));
    const chunks = chunkEvents(events);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0]!.length, STREAM_BATCH_MAX_EVENTS);
    assert.equal(chunks[1]!.length, 5);
    // Oldest first across the whole sequence.
    const flat = chunks.flat();
    for (let i = 1; i < flat.length; i++) assert.ok(flat[i]!.ts >= flat[i - 1]!.ts);
  });

  it('returns no chunks for no events', () => {
    assert.deepEqual(chunkEvents([]), []);
  });
});
