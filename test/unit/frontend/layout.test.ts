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

  it('arrow keys on the bottom/corner handles resize height (y-axis)', () => {
    const grid = document.createElement('div');
    document.body.appendChild(grid);
    const panels = makePanels(['a']);
    const mgr = mountLayout(grid, panels, () => {});
    mgr.apply(baseLayout(['a']));
    mgr.setMode('resize');

    const bottomHandle = panels.a!.querySelector<HTMLElement>('.wv-resize-handle--bottom')!;
    bottomHandle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.equal(panels.a!.dataset.size, 'tall');
    bottomHandle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    assert.equal(panels.a!.dataset.size, 'normal');

    const cornerHandle = panels.a!.querySelector<HTMLElement>('.wv-resize-handle--corner')!;
    cornerHandle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    assert.equal(panels.a!.dataset.span, '1');
    cornerHandle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(panels.a!.dataset.span, '2');

    grid.remove();
  });

  it('clicking the hide button toggles wv-hidden-panel and emits', () => {
    const grid = document.createElement('div');
    document.body.appendChild(grid);
    const panels = makePanels(['a']);
    const changes: DashboardLayout[] = [];
    const mgr = mountLayout(grid, panels, (l) => changes.push(l));
    mgr.apply(baseLayout(['a']));

    const hideBtn = panels.a!.querySelector<HTMLElement>('[data-act="hide"]')!;
    hideBtn.click();
    assert.equal(panels.a!.classList.contains('wv-hidden-panel'), true);
    assert.equal(changes.at(-1)?.[0]?.hidden, true);

    hideBtn.click();
    assert.equal(panels.a!.classList.contains('wv-hidden-panel'), false);
    assert.equal(changes.at(-1)?.[0]?.hidden, false);

    grid.remove();
  });

  it('dragging a resize handle resizes width and height, snapping to the nearest preset', () => {
    const grid = document.createElement('div');
    document.body.appendChild(grid);
    const panels = makePanels(['a']);
    const changes: DashboardLayout[] = [];
    const mgr = mountLayout(grid, panels, (l) => changes.push(l));
    mgr.apply(baseLayout(['a']));
    mgr.setMode('resize');

    const el = panels.a!;
    const rect = { width: 300, height: 120, left: 0, top: 0, right: 300, bottom: 120, x: 0, y: 0, toJSON() { return this; } };
    el.getBoundingClientRect = () => rect as DOMRect;

    const cornerHandle = el.querySelector<HTMLElement>('.wv-resize-handle--corner')!;
    cornerHandle.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }));
    // Drag well past the width snap threshold and toward the "tall" height preset.
    cornerHandle.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, clientX: 400, clientY: 400, pointerId: 1 }));
    assert.equal(el.dataset.span, '2', 'dragging right snaps to the wide preset');
    assert.equal(el.dataset.size, 'tall', 'dragging down snaps to the tallest preset');
    cornerHandle.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));

    // Further pointermoves after pointerup must not resize (listeners detached).
    const before = changes.length;
    cornerHandle.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }));
    assert.equal(changes.length, before, 'no further changes once the drag ends');

    grid.remove();
  });

  it('pointerdown on a resize handle is a no-op outside resize mode', () => {
    const grid = document.createElement('div');
    document.body.appendChild(grid);
    const panels = makePanels(['a']);
    const changes: DashboardLayout[] = [];
    const mgr = mountLayout(grid, panels, (l) => changes.push(l));
    mgr.apply(baseLayout(['a']));
    // mode is 'none' — never entered resize mode.

    const el = panels.a!;
    const rightHandle = el.querySelector<HTMLElement>('.wv-resize-handle--right')!;
    rightHandle.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }));
    rightHandle.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, clientX: 500, clientY: 0, pointerId: 1 }));
    assert.equal(changes.length, 0);

    grid.remove();
  });

  it('drag-and-drop highlights and clears the drop target as the pointer enters/leaves', () => {
    const grid = document.createElement('div');
    document.body.appendChild(grid);
    const panels = makePanels(['a', 'b']);
    const mgr = mountLayout(grid, panels, () => {});
    mgr.apply(baseLayout(['a', 'b']));
    mgr.setMode('move');

    panels.a!.dispatchEvent(new window.Event('dragstart', { bubbles: true }));
    panels.b!.dispatchEvent(new window.Event('dragenter', { bubbles: true }));
    assert.equal(panels.b!.classList.contains('wv-drop-target'), true);

    panels.b!.dispatchEvent(new window.Event('dragleave', { bubbles: true }));
    assert.equal(panels.b!.classList.contains('wv-drop-target'), false);

    panels.b!.dispatchEvent(new window.Event('dragenter', { bubbles: true }));
    panels.a!.dispatchEvent(new window.Event('dragend', { bubbles: true }));
    assert.equal(panels.b!.classList.contains('wv-drop-target'), false, 'dragend clears every drop-target highlight');

    grid.remove();
  });

  it('dragover only preventDefaults while dragging in move mode', () => {
    const grid = document.createElement('div');
    document.body.appendChild(grid);
    const panels = makePanels(['a', 'b']);
    const mgr = mountLayout(grid, panels, () => {});
    mgr.apply(baseLayout(['a', 'b']));

    const overOutsideMove = new window.Event('dragover', { bubbles: true, cancelable: true });
    panels.b!.dispatchEvent(overOutsideMove);
    assert.equal(overOutsideMove.defaultPrevented, false);

    mgr.setMode('move');
    panels.a!.dispatchEvent(new window.Event('dragstart', { bubbles: true }));
    const overDuringMove = new window.Event('dragover', { bubbles: true, cancelable: true });
    panels.b!.dispatchEvent(overDuringMove);
    assert.equal(overDuringMove.defaultPrevented, true);

    grid.remove();
  });

  it('flip() animates a panel whose position actually changed across a reorder', async () => {
    const grid = document.createElement('div');
    document.body.appendChild(grid);
    const panels = makePanels(['a', 'b']);
    const mgr = mountLayout(grid, panels, () => {});
    mgr.apply(baseLayout(['a', 'b']));
    mgr.setMode('move');

    const rect = (left: number) =>
      ({ left, top: 0, width: 100, height: 100, right: left + 100, bottom: 100, x: left, y: 0, toJSON() { return this; } }) as DOMRect;
    let call = 0;
    // First call ("before") returns 0; every call after the DOM reorder
    // ("after") returns 50 — simulating a real layout shift.
    panels.a!.getBoundingClientRect = () => rect(call++ === 0 ? 0 : 50);

    panels.a!.dispatchEvent(new window.Event('dragstart', { bubbles: true }));
    panels.b!.dispatchEvent(new window.Event('drop', { bubbles: true, cancelable: true }));

    // The outer requestAnimationFrame (stubbed to setTimeout) sets the
    // transform/transition to animate from the old position.
    await new Promise((r) => setTimeout(r, 0));
    assert.notEqual(panels.a!.style.transform, '', 'transform set for a panel that moved');

    // The nested requestAnimationFrame then resets it to animate back to 0.
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(panels.a!.style.transform, '');

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
