import { strict as assert } from 'assert';
import { mountLayout } from '../../../src/extension-frontend/layout';
import type { DashboardLayout } from '../../../src/extension-backend/domain/types';

function makePanels(ids: string[]): Record<string, HTMLElement> {
  const panels: Record<string, HTMLElement> = {};
  for (const id of ids) {
    const el = document.createElement('div');
    el.className = 'wv-chart-section';
    document.body.appendChild(el);
    panels[id] = el;
  }
  return panels;
}

function baseLayout(ids: string[]): DashboardLayout {
  return ids.map((id) => ({ id, span: 1 as const, hidden: false }));
}

describe('layout — mountLayout', () => {
  it('apply() sets span/size/hidden dataset attributes per panel', () => {
    const grid = document.createElement('div');
    document.body.appendChild(grid);
    const panels = makePanels(['a', 'b']);
    const mgr = mountLayout(grid, panels, () => {});

    mgr.apply([
      { id: 'a', span: 2, size: 'tall', hidden: false },
      { id: 'b', span: 1, hidden: true },
    ]);

    assert.equal(panels.a!.dataset.span, '2');
    assert.equal(panels.a!.dataset.size, 'tall');
    assert.equal(panels.a!.classList.contains('wv-hidden-panel'), false);
    assert.equal(panels.b!.dataset.span, '1');
    assert.equal(panels.b!.classList.contains('wv-hidden-panel'), true);

    grid.remove();
  });

  it('setMode toggles wv-editing, data-layout-mode, and draggable — resize and move are mutually exclusive', () => {
    const grid = document.createElement('div');
    document.body.appendChild(grid);
    const panels = makePanels(['a']);
    const mgr = mountLayout(grid, panels, () => {});
    mgr.apply(baseLayout(['a']));

    mgr.setMode('resize');
    assert.equal(grid.classList.contains('wv-editing'), true);
    assert.equal(grid.dataset.layoutMode, 'resize');
    assert.equal(panels.a!.draggable, false);

    mgr.setMode('move');
    assert.equal(grid.dataset.layoutMode, 'move');
    assert.equal(panels.a!.draggable, true);

    mgr.setMode('none');
    assert.equal(grid.classList.contains('wv-editing'), false);
    assert.equal(panels.a!.draggable, false);

    grid.remove();
  });

  it('clicking the width resize handle cycles span 1 <-> 2 and emits the change', () => {
    const grid = document.createElement('div');
    document.body.appendChild(grid);
    const panels = makePanels(['a']);
    const changes: DashboardLayout[] = [];
    const mgr = mountLayout(grid, panels, (l) => changes.push(l));
    mgr.apply(baseLayout(['a']));
    mgr.setMode('resize');

    const rightHandle = panels.a!.querySelector<HTMLElement>('.wv-resize-handle--right')!;
    rightHandle.click();
    assert.equal(panels.a!.dataset.span, '2');
    assert.equal(changes.at(-1)?.[0]?.span, 2);

    rightHandle.click();
    assert.equal(panels.a!.dataset.span, '1');
    assert.equal(changes.at(-1)?.[0]?.span, 1);

    grid.remove();
  });

  it('clicking the height resize handle cycles compact -> normal -> tall and emits each change', () => {
    const grid = document.createElement('div');
    document.body.appendChild(grid);
    const panels = makePanels(['a']);
    const changes: DashboardLayout[] = [];
    const mgr = mountLayout(grid, panels, (l) => changes.push(l));
    mgr.apply(baseLayout(['a']));
    mgr.setMode('resize');

    const bottomHandle = panels.a!.querySelector<HTMLElement>('.wv-resize-handle--bottom')!;
    bottomHandle.click();
    assert.equal(panels.a!.dataset.size, 'tall');
    assert.equal(changes.at(-1)?.[0]?.size, 'tall');

    // Already at the top of the cycle — clicking again is a no-op, no new emit.
    const before = changes.length;
    bottomHandle.click();
    assert.equal(changes.length, before);

    grid.remove();
  });

  it('arrow keys on a resize handle resize width/height, only while in resize mode', () => {
    const grid = document.createElement('div');
    document.body.appendChild(grid);
    const panels = makePanels(['a']);
    const changes: DashboardLayout[] = [];
    const mgr = mountLayout(grid, panels, (l) => changes.push(l));
    mgr.apply(baseLayout(['a']));

    const rightHandle = panels.a!.querySelector<HTMLElement>('.wv-resize-handle--right')!;
    rightHandle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(panels.a!.dataset.span, '1', 'no-op outside resize mode');

    mgr.setMode('resize');
    rightHandle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(panels.a!.dataset.span, '2');
    rightHandle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    assert.equal(panels.a!.dataset.span, '1');

    grid.remove();
  });

  it('drag-and-drop reorders panels only in move mode, and emits the new order', () => {
    const grid = document.createElement('div');
    document.body.appendChild(grid);
    const panels = makePanels(['a', 'b', 'c']);
    const changes: DashboardLayout[] = [];
    const mgr = mountLayout(grid, panels, (l) => changes.push(l));
    mgr.apply(baseLayout(['a', 'b', 'c']));

    // Outside move mode, dragstart never arms a drag (mode !== 'move').
    panels.a!.dispatchEvent(new window.Event('dragstart', { bubbles: true }));
    panels.c!.dispatchEvent(new window.Event('drop', { bubbles: true, cancelable: true }));
    assert.equal(changes.length, 0);

    mgr.setMode('move');
    panels.a!.dispatchEvent(new window.Event('dragstart', { bubbles: true }));
    panels.c!.dispatchEvent(new window.Event('drop', { bubbles: true, cancelable: true }));

    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0]!.map((p) => p.id), ['b', 'c', 'a']);

    grid.remove();
  });
});
