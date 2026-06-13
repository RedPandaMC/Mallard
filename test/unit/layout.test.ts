import { strict as assert } from 'assert';
import { normalizeLayout } from '../../src/domain/layout';
import { DASHBOARD_PANELS, DEFAULT_DASHBOARD_LAYOUT } from '../../src/domain/types';

describe('normalizeLayout', () => {
  it('returns the defaults when nothing is stored', () => {
    assert.deepEqual(normalizeLayout(undefined), DEFAULT_DASHBOARD_LAYOUT);
  });

  it('preserves stored order, span, and visibility', () => {
    const stored = [
      { id: 'category', span: 2 as const, hidden: false },
      { id: 'daily', span: 1 as const, hidden: true },
    ];
    const out = normalizeLayout(stored);
    assert.equal(out[0]!.id, 'category');
    assert.equal(out[0]!.span, 2);
    assert.equal(out[1]!.id, 'daily');
    assert.equal(out[1]!.hidden, true);
  });

  it('drops unknown and duplicate ids and appends missing panels', () => {
    const stored = [
      { id: 'daily', span: 2 as const, hidden: false },
      { id: 'daily', span: 1 as const, hidden: true }, // duplicate
      { id: 'bogus', span: 1 as const, hidden: false }, // unknown
    ];
    const out = normalizeLayout(stored);
    // Every known panel appears exactly once.
    assert.deepEqual(
      [...out.map((p) => p.id)].sort(),
      [...DASHBOARD_PANELS].sort(),
    );
    assert.equal(out.filter((p) => p.id === 'daily').length, 1);
    assert.equal(out.find((p) => p.id === 'bogus'), undefined);
    // The kept 'daily' is the first occurrence (span 2).
    assert.equal(out.find((p) => p.id === 'daily')!.span, 2);
  });

  it('coerces invalid span values to 1', () => {
    const out = normalizeLayout([{ id: 'models', span: 5 as unknown as 1, hidden: false }]);
    assert.equal(out.find((p) => p.id === 'models')!.span, 1);
  });
});
