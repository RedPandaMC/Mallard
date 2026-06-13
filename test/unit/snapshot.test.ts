import { strict as assert } from 'assert';
import { buildSnapshot, SnapshotOptions } from '../../src/domain/snapshot';
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
});
