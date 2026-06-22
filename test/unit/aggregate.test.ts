import { strict as assert } from 'assert';
import {
  aggregateAll,
  aggregateBy,
  buildFilterPredicate,
  distinctModels,
  distinctRepos,
  distinctSources,
  distinctSurfaces,
  matchesFilter,
  sankeyLinksFor,
  sumEvents,
  tokensOf,
  topBy,
  UNATTRIBUTED_REPO,
} from '../../src/domain/aggregate';
import type { Surface, UsageEvent } from '../../src/domain/types';
import { makeEvent } from './helpers';

describe('aggregate', () => {
  const d1 = new Date(2026, 5, 10, 9).getTime();
  const d1b = new Date(2026, 5, 10, 15).getTime();
  const d2 = new Date(2026, 5, 11, 9).getTime();

  const events = [
    makeEvent({ ts: d1, credits: 2, cost: 0.08, modelId: 'gpt-4o', surface: 'chat' }),
    makeEvent({ ts: d1b, credits: 1, cost: 0.04, modelId: 'claude-sonnet-4', surface: 'inline' }),
    makeEvent({ ts: d2, credits: 3, cost: 0.12, modelId: 'gpt-4o', surface: 'agent' }),
  ];

  it('buckets by day and sums credits/cost', () => {
    const days = aggregateBy(events, 'day');
    assert.equal(days.length, 2);
    assert.equal(days[0]!.bucketKey, '2026-06-10');
    assert.equal(days[0]!.credits, 3);
    assert.ok(Math.abs(days[0]!.cost - 0.12) < 1e-9);
    assert.equal(days[0]!.eventCount, 2);
  });

  it('breaks down by model', () => {
    const days = aggregateBy(events, 'day');
    assert.equal(days[0]!.byModel['gpt-4o']!.credits, 2);
    assert.equal(days[0]!.byModel['claude-sonnet-4']!.credits, 1);
  });

  it('attributes and filters by repo, treating missing repo as unattributed', () => {
    const repoEvents = [
      makeEvent({ ts: d1, credits: 2, repo: 'octo/a' }),
      makeEvent({ ts: d2, credits: 3, repo: 'octo/b' }),
      makeEvent({ ts: d2, credits: 1 }), // no repo
    ];
    assert.deepEqual(distinctRepos(repoEvents), ['octo/a', 'octo/b', UNATTRIBUTED_REPO]);

    const byRepo = topBy(repoEvents, 'repo');
    assert.equal(byRepo.find((r) => r.key === 'octo/b')!.credits, 3);

    const onlyA = sumEvents(repoEvents, { repos: ['octo/a'] });
    assert.equal(onlyA.credits, 2);
    const unattributed = sumEvents(repoEvents, { repos: [UNATTRIBUTED_REPO] });
    assert.equal(unattributed.credits, 1);
  });

  it('produces day, week, month granularities', () => {
    const all = aggregateAll(events);
    assert.deepEqual(Object.keys(all).sort(), ['day', 'month', 'week']);
    assert.equal(all.month[0]!.credits, 6);
  });

  it('applies a model filter', () => {
    const days = aggregateBy(events, 'day', { models: ['gpt-4o'] });
    const total = days.reduce((s, a) => s + a.credits, 0);
    assert.equal(total, 5);
  });

  it('applies a surface filter', () => {
    const days = aggregateBy(events, 'day', { surfaces: ['chat'] });
    const total = days.reduce((s, a) => s + a.credits, 0);
    assert.equal(total, 2);
  });

  it('ranks top models by credits', () => {
    const top = topBy(events, 'model');
    assert.equal(top[0]!.key, 'gpt-4o');
    assert.equal(top[0]!.credits, 5);
  });

  it('ranks top surfaces by credits', () => {
    const top = topBy(events, 'surface');
    assert.ok(top.length > 0);
    const keys = top.map((t) => t.key);
    assert.ok(keys.includes('chat') || keys.includes('inline') || keys.includes('agent'));
    // agent has 3 credits, chat has 2, inline has 1
    assert.equal(top[0]!.key, 'agent');
    assert.equal(top[0]!.credits, 3);
  });

  it('builds sankey links', () => {
    const links = sankeyLinksFor(events);
    const chat = links.find((l) => l.source === 'gpt-4o' && l.target === 'chat');
    assert.ok(chat, 'should have gpt-4o → chat link');
    assert.equal(chat!.value, 2);
  });

  it('handles empty input', () => {
    assert.deepEqual(aggregateBy([], 'day'), []);
    assert.deepEqual(sumEvents([]), { credits: 0, cost: 0, tokens: 0, count: 0 });
  });

  it('filters by source', () => {
    const mixed = [
      makeEvent({ ts: d1, credits: 5, source: 'local' }),
      makeEvent({ ts: d2, credits: 3, source: 'claude-code' }),
    ];
    const copilotOnly = sumEvents(mixed, { sources: ['local'] });
    assert.equal(copilotOnly.credits, 5);
    const claudeOnly = sumEvents(mixed, { sources: ['claude-code'] });
    assert.equal(claudeOnly.credits, 3);
  });

  it('filters by branch', () => {
    const branched = [
      makeEvent({ ts: d1, credits: 4, branch: 'main' }),
      makeEvent({ ts: d2, credits: 2, branch: 'feature/x' }),
    ];
    const mainOnly = sumEvents(branched, { branches: ['main'] });
    assert.equal(mainOnly.credits, 4);
  });

  it('distinctSources returns source kinds in canonical order', () => {
    const mixed = [
      makeEvent({ ts: d1, source: 'claude-code' }),
      makeEvent({ ts: d2, source: 'lm' }),
      makeEvent({ ts: d2, source: 'local' }),
    ];
    const sources = distinctSources(mixed);
    assert.deepEqual(sources, ['lm', 'local', 'claude-code']);
  });

  it('topBy rejects events that do not match the filter', () => {
    const top = topBy(events, 'model', { models: ['gpt-4o'] });
    assert.equal(top.length, 1);
    assert.equal(top[0]!.key, 'gpt-4o');
    assert.ok(!top.some((t) => t.key === 'claude-sonnet-4'));
  });

  it('sankeyLinksFor filters out events that do not match', () => {
    const links = sankeyLinksFor(events, { models: ['gpt-4o'] });
    assert.ok(links.every((l) => l.source === 'gpt-4o'));
  });

  it('sankeyLinksFor skips zero-credit events', () => {
    const withZero = [
      makeEvent({ ts: d1, credits: 0, modelId: 'gpt-4o', surface: 'chat' }),
      makeEvent({ ts: d1b, credits: 2, modelId: 'gpt-4o', surface: 'chat' }),
    ];
    const links = sankeyLinksFor(withZero);
    assert.equal(links.length, 1);
    assert.equal(links[0]!.value, 2);
  });

  it('distinctModels rejects events not matching filter', () => {
    const models = distinctModels(events, { models: ['gpt-4o'] });
    assert.deepEqual(models, ['gpt-4o']);
  });

  it('distinctRepos rejects events not matching filter', () => {
    const repoEvents = [
      makeEvent({ ts: d1, repo: 'octo/a' }),
      makeEvent({ ts: d2, repo: 'octo/b' }),
    ];
    const repos = distinctRepos(repoEvents, { repos: ['octo/a'] });
    assert.deepEqual(repos, ['octo/a']);
  });

  it('distinctSurfaces rejects events not matching filter', () => {
    const surfaces = distinctSurfaces(events, { surfaces: ['chat'] });
    assert.deepEqual(surfaces, ['chat']);
  });

  it('matchesFilter rejects all events when range is inverted (start > end)', () => {
    const result = sumEvents([makeEvent({ ts: d1, credits: 5 })], { range: { start: d2, end: d1 } });
    assert.equal(result.count, 0);
    assert.equal(result.credits, 0);
  });

  it('tokensOf sums negative token values (documents raw summation behavior)', () => {
    const e = { ...makeEvent({ ts: Date.now() - 1000 }), promptTokens: -50, completionTokens: 30 } as UsageEvent;
    assert.equal(tokensOf(e), -20);
  });

  it('topBy stable-sorts ties by cost when credits are equal', () => {
    const tied = [
      makeEvent({ ts: d1, credits: 5, cost: 0.10, modelId: 'model-a' }),
      makeEvent({ ts: d1, credits: 5, cost: 0.20, modelId: 'model-b' }),
    ];
    const top = topBy(tied, 'model');
    assert.equal(top[0]!.key, 'model-b'); // higher cost wins tie
  });

  it('distinctSources rejects events not matching filter', () => {
    const mixed = [
      makeEvent({ ts: d1, source: 'local' }),
      makeEvent({ ts: d2, source: 'claude-code' }),
    ];
    const sources = distinctSources(mixed, { sources: ['local'] });
    assert.deepEqual(sources, ['local']);
  });
});

// ── matchesFilter ─────────────────────────────────────────────────────────────

describe('matchesFilter', () => {
  const ts = new Date(2026, 5, 15, 10).getTime();

  it('no filter → always matches', () => {
    assert.equal(matchesFilter(makeEvent({ ts })), true);
    assert.equal(matchesFilter(makeEvent({ ts }), undefined), true);
  });

  it('range filter: event inside range matches', () => {
    assert.equal(matchesFilter(makeEvent({ ts }), { range: { start: ts - 1000, end: ts + 1000 } }), true);
  });

  it('range filter: event at start boundary matches (ts >= start)', () => {
    assert.equal(matchesFilter(makeEvent({ ts }), { range: { start: ts, end: ts + 1000 } }), true);
  });

  it('range filter: event at end boundary excluded (ts < end)', () => {
    assert.equal(matchesFilter(makeEvent({ ts }), { range: { start: ts - 1000, end: ts } }), false);
  });

  it('models filter: exact match', () => {
    const e = makeEvent({ ts, modelId: 'gpt-4o' });
    assert.equal(matchesFilter(e, { models: ['gpt-4o'] }), true);
  });

  it('models filter: non-matching model excluded', () => {
    const e = makeEvent({ ts, modelId: 'gpt-4o' });
    assert.equal(matchesFilter(e, { models: ['claude-3-opus'] }), false);
  });

  it('surfaces filter', () => {
    const e = makeEvent({ ts, surface: 'chat' });
    assert.equal(matchesFilter(e, { surfaces: ['chat'] }), true);
    assert.equal(matchesFilter(e, { surfaces: ['inline'] }), false);
  });

  it('repos filter: named repo', () => {
    const e = makeEvent({ ts, repo: 'my-repo' });
    assert.equal(matchesFilter(e, { repos: ['my-repo'] }), true);
    assert.equal(matchesFilter(e, { repos: ['other-repo'] }), false);
  });

  it('repos filter: UNATTRIBUTED_REPO matches event with null repo', () => {
    const e = makeEvent({ ts });
    assert.equal(matchesFilter(e, { repos: [UNATTRIBUTED_REPO] }), true);
    assert.equal(matchesFilter(e, { repos: ['some-repo'] }), false);
  });

  it('branches filter', () => {
    const e = makeEvent({ ts, branch: 'main' });
    assert.equal(matchesFilter(e, { branches: ['main'] }), true);
    assert.equal(matchesFilter(e, { branches: ['feature/x'] }), false);
  });

  it('branches filter: event without branch uses empty-string fallback', () => {
    const e = makeEvent({ ts }); // no branch property
    // Event has no branch, filter expects 'main' → excluded
    assert.equal(matchesFilter(e, { branches: ['main'] }), false);
    // Event has no branch, filter includes '' → included
    assert.equal(matchesFilter(e, { branches: [''] }), true);
  });

  it('sources filter', () => {
    const e = makeEvent({ ts, source: 'local' });
    assert.equal(matchesFilter(e, { sources: ['local'] }), true);
    assert.equal(matchesFilter(e, { sources: ['github'] }), false);
  });

  it('multi-facet: must satisfy ALL specified facets', () => {
    const e = makeEvent({ ts, modelId: 'gpt-4o', surface: 'chat', source: 'local' });
    assert.equal(matchesFilter(e, { models: ['gpt-4o'], surfaces: ['inline'] }), false);
    assert.equal(matchesFilter(e, { models: ['gpt-4o'], surfaces: ['chat'] }), true);
  });

  it('empty arrays on a facet → same as not specifying the facet', () => {
    const e = makeEvent({ ts, modelId: 'gpt-4o' });
    assert.equal(matchesFilter(e, { models: [] }), true);
    assert.equal(matchesFilter(e, { surfaces: [] }), true);
  });
});

// ── buildFilterPredicate ──────────────────────────────────────────────────────

describe('buildFilterPredicate', () => {
  const ts = new Date(2026, 5, 15, 10).getTime();

  it('returns a function equivalent to matchesFilter(e, filter)', () => {
    const filter = { models: ['gpt-4o'] };
    const predicate = buildFilterPredicate(filter);
    const e1 = makeEvent({ ts, modelId: 'gpt-4o' });
    const e2 = makeEvent({ ts, modelId: 'claude-3-opus' });
    assert.equal(predicate(e1), matchesFilter(e1, filter));
    assert.equal(predicate(e2), matchesFilter(e2, filter));
  });

  it('same predicate applied to multiple events', () => {
    const filter = { surfaces: ['chat', 'inline'] as Surface[] };
    const predicate = buildFilterPredicate(filter);
    const events = [
      makeEvent({ ts, surface: 'chat' }),
      makeEvent({ ts, surface: 'agent' }),
      makeEvent({ ts, surface: 'inline' }),
    ];
    const result = events.filter(predicate);
    assert.equal(result.length, 2);
    assert.ok(result.every((e) => e.surface === 'chat' || e.surface === 'inline'));
  });
});
