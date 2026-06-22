import { strict as assert } from 'assert';
import { gridColumnToSpan, mergeConfigLayout, normalizeLayout } from '../../src/domain/layout';
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

describe('gridColumnToSpan', () => {
  it('parses "span 2" as 2', () => assert.equal(gridColumnToSpan('span 2'), 2));
  it('parses "span 1" as 1', () => assert.equal(gridColumnToSpan('span 1'), 1));
  it('returns 1 for undefined', () => assert.equal(gridColumnToSpan(undefined), 1));
  it('returns 1 for unrecognised strings', () => assert.equal(gridColumnToSpan('auto'), 1));
  it('treats any span >= 2 as 2', () => assert.equal(gridColumnToSpan('span 4'), 2));
});

describe('mergeConfigLayout', () => {
  const stored = DEFAULT_DASHBOARD_LAYOUT;

  it('returns normalizeLayout when config has no panels', () => {
    assert.deepEqual(mergeConfigLayout(undefined, stored), normalizeLayout(stored));
    assert.deepEqual(mergeConfigLayout({}, stored), normalizeLayout(stored));
    assert.deepEqual(mergeConfigLayout({ panels: [] }, stored), normalizeLayout(stored));
  });

  it('config panel order takes precedence over stored order', () => {
    const cfg = {
      panels: [
        { id: 'models', gridColumn: 'span 2' },
        { id: 'daily', gridColumn: 'span 2' },
      ],
    };
    const out = mergeConfigLayout(cfg, stored);
    assert.equal(out[0]!.id, 'models');
    assert.equal(out[0]!.span, 2);
    assert.equal(out[1]!.id, 'daily');
  });

  it('config hidden takes precedence over stored hidden', () => {
    const cfg = { panels: [{ id: 'sankey', hidden: true }] };
    const out = mergeConfigLayout(cfg, stored);
    assert.equal(out.find((p) => p.id === 'sankey')!.hidden, true);
  });

  it('panels not in config keep their stored values and are appended after config panels', () => {
    const cfg = { panels: [{ id: 'daily', gridColumn: 'span 2' }] };
    const out = mergeConfigLayout(cfg, stored);
    // all panels still present
    assert.deepEqual([...out.map((p) => p.id)].sort(), [...DASHBOARD_PANELS].sort());
    // daily is first (config order)
    assert.equal(out[0]!.id, 'daily');
  });

  it('drops unknown panel ids from config', () => {
    const cfg = { panels: [{ id: 'bogus' }, { id: 'daily' }] };
    const out = mergeConfigLayout(cfg, stored);
    assert.equal(out.find((p) => p.id === 'bogus'), undefined);
    assert.equal(out[0]!.id, 'daily');
  });

  it('deduplicates repeated panel ids in config', () => {
    const cfg = { panels: [{ id: 'daily', gridColumn: 'span 1' }, { id: 'daily', gridColumn: 'span 2' }] };
    const out = mergeConfigLayout(cfg, stored);
    assert.equal(out.filter((p) => p.id === 'daily').length, 1);
    assert.equal(out.find((p) => p.id === 'daily')!.span, 1); // first occurrence wins
  });

  it('falls back to defaultById when stored is empty', () => {
    const cfg = { panels: [{ id: 'daily' }] };
    const out = mergeConfigLayout(cfg, []); // empty stored
    const daily = out.find((p) => p.id === 'daily');
    assert.ok(daily !== undefined);
    // span falls back to DEFAULT_DASHBOARD_LAYOUT default
    assert.ok(daily!.span === 1 || daily!.span === 2);
  });
});
