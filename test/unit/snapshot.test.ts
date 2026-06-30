import { strict as assert } from 'assert';
import { buildSnapshot, SnapshotOptions } from '../../src/client_extension/domain/snapshot';
import { makeEvent } from './helpers';

function opts(over: Partial<SnapshotOptions>): SnapshotOptions {
  return {
    now: Date.now(),
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

describe('buildSnapshot', () => {
  it('derives filter dropdown options from dimensionEvents, not the filtered set', () => {
    const ts = Date.now() - 1000;
    const universe = [
      makeEvent({ ts, modelId: 'gpt-4o', surface: 'chat', repo: 'octo/a' }),
      makeEvent({ ts, modelId: 'claude-sonnet-4', surface: 'inline', repo: 'octo/b' }),
    ];
    // The user has filtered down to a single model; filteredEvents reflects that.
    const filtered = [universe[0]!];

    const s = buildSnapshot(filtered, opts({ filter: { models: ['gpt-4o'] }, dimensionEvents: universe }));

    // Choices stay complete so the user can widen or switch the selection.
    assert.deepEqual(s.allModels, ['claude-sonnet-4', 'gpt-4o']);
    assert.deepEqual(s.allSurfaces, ['chat', 'inline']);
    assert.deepEqual(s.allRepos, ['octo/a', 'octo/b']);
    // Totals still reflect the filtered set only.
    assert.equal(s.topModels.length, 1);
    assert.equal(s.topModels[0]!.key, 'gpt-4o');
  });

  it('falls back to the event set when dimensionEvents is omitted', () => {
    const s = buildSnapshot([makeEvent({ ts: Date.now() - 1000, modelId: 'gpt-4o' })], opts({}));
    assert.deepEqual(s.allModels, ['gpt-4o']);
  });

  it('currentBranch option tracks credits for matching branch', () => {
    const now = Date.now();
    const events = [
      makeEvent({ ts: now - 1000, modelId: 'gpt-4o', branch: 'main', credits: 5 }),
      makeEvent({ ts: now - 2000, modelId: 'gpt-4o', branch: 'feature/x', credits: 3 }),
    ];
    const s = buildSnapshot(events, opts({ now, currentBranch: 'main' }));
    assert.equal(s.currentBranch, 'main');
    assert.equal(s.currentBranchCredits, 5);
  });

  it('computeRange uses min/max timestamps across all events', () => {
    const t1 = Date.now() - 5000;
    const t2 = Date.now() - 3000;
    const t3 = Date.now() - 1000;
    const events = [
      makeEvent({ ts: t2, modelId: 'gpt-4o' }),
      makeEvent({ ts: t1, modelId: 'gpt-4o' }),
      makeEvent({ ts: t3, modelId: 'gpt-4o' }),
    ];
    const s = buildSnapshot(events, opts({ now: Date.now() }));
    assert.equal(s.range.start, t1);
    assert.equal(s.range.end, t3);
  });

  it('isIncremental is true when filter and daily bars match previous snapshot', () => {
    const now = Date.now();
    const events = [makeEvent({ ts: now - 1000, modelId: 'gpt-4o', credits: 1 })];
    const first = buildSnapshot(events, opts({ now }));
    const second = buildSnapshot(events, opts({ now: now + 100, prevSnapshot: first }));
    assert.equal(second.isIncremental, true);
  });

  it('isIncremental is false when filter changes between snapshots', () => {
    const now = Date.now();
    const events = [makeEvent({ ts: now - 1000, modelId: 'gpt-4o', credits: 1 })];
    const first = buildSnapshot(events, opts({ now, filter: {} }));
    const second = buildSnapshot(
      events,
      opts({ now: now + 100, prevSnapshot: first, filter: { models: ['gpt-4o'] } }),
    );
    assert.equal(second.isIncremental, false);
  });

  it('buildSnapshot with empty events uses now-based range', () => {
    const now = Date.now();
    const s = buildSnapshot([], opts({ now }));
    assert.ok(s.range.start < now);
    assert.equal(s.range.end, now);
    assert.equal(s.topModels.length, 0);
  });

  it('isIncremental is false when daily bar point counts differ', () => {
    const now = Date.now();
    const events = [makeEvent({ ts: now - 1000, modelId: 'gpt-4o', credits: 1 })];
    const first = buildSnapshot(events, opts({ now }));
    const mutatedFirst = {
      ...first,
      chartData: {
        ...first.chartData,
        dailyBars: { ...first.chartData.dailyBars, points: first.chartData.dailyBars.points.slice(0, 15) },
      },
    };
    const second = buildSnapshot(events, opts({ now: now + 100, prevSnapshot: mutatedFirst as typeof first }));
    assert.equal(second.isIncremental, false);
  });

  it('isIncremental is false when a non-last daily bar has different credits', () => {
    const now = Date.now();
    const day5ago = now - 5 * 24 * 60 * 60 * 1000;
    const eventsA = [makeEvent({ ts: day5ago, modelId: 'gpt-4o', credits: 1 })];
    const eventsB = [makeEvent({ ts: day5ago, modelId: 'gpt-4o', credits: 9 })];
    const first = buildSnapshot(eventsA, opts({ now }));
    const second = buildSnapshot(eventsB, opts({ now: now + 100, prevSnapshot: first }));
    assert.equal(second.isIncremental, false);
  });

  it('currentBranch empty string is falsy — no branch credits are tracked', () => {
    const now = Date.now();
    const events = [makeEvent({ ts: now - 1000, branch: '', credits: 5 })];
    const s = buildSnapshot(events, opts({ now, currentBranch: '' }));
    assert.equal(s.currentBranchCredits, 0);
    assert.equal(s.currentBranch, '');
  });
});
