import { strict as assert } from 'assert';
import { configPanelsToLayout, gridColumnToSpan, layoutToConfigPanels, normalizeLayout } from '../../src/extension-backend/domain/layout';
import { DASHBOARD_PANELS, DEFAULT_DASHBOARD_LAYOUT } from '../../src/extension-backend/domain/types';

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

  it('clamps an out-of-range span to the max (4)', () => {
    const out = normalizeLayout([{ id: 'models', span: 99, hidden: false }]);
    assert.equal(out.find((p) => p.id === 'models')!.span, 4);
  });

  it('coerces a non-numeric span to 1', () => {
    const out = normalizeLayout([{ id: 'models', span: NaN as unknown as number, hidden: false }]);
    assert.equal(out.find((p) => p.id === 'models')!.span, 1);
  });

  it('keeps spans 3 and 4', () => {
    const out = normalizeLayout([
      { id: 'models', span: 3, hidden: false },
      { id: 'sankey', span: 4, hidden: false },
    ]);
    assert.equal(out.find((p) => p.id === 'models')!.span, 3);
    assert.equal(out.find((p) => p.id === 'sankey')!.span, 4);
  });
});

describe('gridColumnToSpan', () => {
  it('parses "span 2" as 2', () => assert.equal(gridColumnToSpan('span 2'), 2));
  it('parses "span 1" as 1', () => assert.equal(gridColumnToSpan('span 1'), 1));
  it('parses "span 3" as 3', () => assert.equal(gridColumnToSpan('span 3'), 3));
  it('parses "span 4" as 4', () => assert.equal(gridColumnToSpan('span 4'), 4));
  it('returns 1 for undefined', () => assert.equal(gridColumnToSpan(undefined), 1));
  it('returns 1 for unrecognised strings', () => assert.equal(gridColumnToSpan('auto'), 1));
  it('clamps a span above the max to 4', () => assert.equal(gridColumnToSpan('span 9'), 4));
});

describe('configPanelsToLayout / layoutToConfigPanels', () => {
  it('returns the defaults for an empty or missing panels block', () => {
    assert.deepEqual(configPanelsToLayout(undefined), DEFAULT_DASHBOARD_LAYOUT);
    assert.deepEqual(configPanelsToLayout([]), DEFAULT_DASHBOARD_LAYOUT);
  });

  it('parses gridColumn spans and preserves order, hidden, and size', () => {
    const out = configPanelsToLayout([
      { id: 'models', gridColumn: 'span 2', hidden: true, size: 'tall' },
      { id: 'daily', gridColumn: 'span 3' },
    ]);
    assert.equal(out[0]!.id, 'models');
    assert.equal(out[0]!.span, 2);
    assert.equal(out[0]!.hidden, true);
    assert.equal(out[0]!.size, 'tall');
    assert.equal(out[1]!.id, 'daily');
    assert.equal(out[1]!.span, 3);
  });

  it('drops unknown ids and duplicates, appending missing panels', () => {
    const out = configPanelsToLayout([
      { id: 'bogus' },
      { id: 'daily', gridColumn: 'span 2' },
      { id: 'daily', gridColumn: 'span 1' },
    ]);
    assert.deepEqual([...out.map((p) => p.id)].sort(), [...DASHBOARD_PANELS].sort());
    assert.equal(out.find((p) => p.id === 'daily')!.span, 2);
  });

  it('round-trips a layout through the config.json shape', () => {
    const layout = normalizeLayout([
      { id: 'sankey', span: 4, hidden: true, size: 'compact' },
      { id: 'daily', span: 2, hidden: false, size: 'normal' },
    ]);
    assert.deepEqual(configPanelsToLayout(layoutToConfigPanels(layout)), layout);
  });

  it('omits default hidden/size values when serializing', () => {
    const panels = layoutToConfigPanels(DEFAULT_DASHBOARD_LAYOUT);
    for (const p of panels) {
      assert.equal('hidden' in p, false);
      assert.equal('size' in p, false);
      assert.match(p.gridColumn!, /^span [1-4]$/);
    }
  });
});
