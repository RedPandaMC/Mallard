import { strict as assert } from 'assert';
import { buildSnapshot } from '../../../src/extension-backend/domain/snapshot';
import { makeEvent } from '../helpers';
import { mountHeatmap } from '../../../src/extension-frontend/charts/heatmap';

function snapshotAt(now: number, events: Parameters<typeof makeEvent>[0][]) {
  return buildSnapshot(
    events.map((e) => makeEvent(e)),
    {
      now, currency: 'USD', pricePerCredit: 0.04, monthlyBudget: 50, includedCredits: 300,
      filter: {}, source: 'local', status: { kind: 'ok' }, authStatus: 'signed-out',
    },
  );
}

describe('heatmap — GitHub-style DOM grid', () => {
  it('renders one cell per day, hides entirely when there is no data', () => {
    const now = Date.now();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountHeatmap(el);

    h.update(snapshotAt(now, []));
    assert.equal(el.style.display, 'none', 'hidden with no data');
    assert.equal(el.querySelectorAll('.wv-heatmap-cell').length, 0);

    el.remove();
  });

  it('shows the grid, buckets the highest day as the peak color, and renders a legend', () => {
    const now = Date.now();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountHeatmap(el);

    h.update(snapshotAt(now, [
      { ts: now, credits: 100 },
      { ts: now - 24 * 3600_000, credits: 10 },
    ]));

    assert.notEqual(el.style.display, 'none');
    const cells = el.querySelectorAll<HTMLElement>('.wv-heatmap-cell:not(.wv-heatmap-legend-swatch)');
    assert.equal(cells.length, 52 * 7 + 1, 'one cell per day in the 52-week window');

    // The last cell (today) carries the highest value → peak bucket.
    const lastCell = cells[cells.length - 1]!;
    assert.ok(lastCell.className.includes('wv-heatmap-cell--4'), 'peak day gets the strongest bucket');

    // At least one month label is rendered across a 52-week span.
    assert.ok(el.querySelectorAll('.wv-heatmap-month-label').length >= 1);

    // Legend: Less <5 swatches> More
    const legend = el.querySelector('.wv-heatmap-legend')!;
    assert.equal(legend.textContent!.includes('Less'), true);
    assert.equal(legend.textContent!.includes('More'), true);
    assert.equal(legend.querySelectorAll('.wv-heatmap-legend-swatch').length, 5);

    el.remove();
  });

  it('gives every day a title with its date and credits for a native tooltip', () => {
    const now = Date.now();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountHeatmap(el);
    h.update(snapshotAt(now, [{ ts: now, credits: 42 }]));

    const cells = el.querySelectorAll<HTMLElement>('.wv-heatmap-cell:not(.wv-heatmap-legend-swatch)');
    const withTitle = [...cells].filter((c) => c.title.includes('cr'));
    assert.ok(withTitle.length > 0);

    el.remove();
  });

  it('reinit() and resize() are safe no-ops (colors follow CSS vars, not a stale chart instance)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = mountHeatmap(el);
    assert.doesNotThrow(() => h.reinit());
    assert.doesNotThrow(() => h.resize());
    el.remove();
  });
});
