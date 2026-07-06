/**
 * Manages the dashboard's analysis grid: applies a persisted layout (panel
 * order, width span, size, visibility) and exposes two independent editing
 * modes:
 *   - "resize": drag handles on each panel's right/bottom/corner edge let
 *     the user resize width (span 1/2) and height (compact/normal/tall),
 *     snapping to the nearest existing preset as they drag.
 *   - "move": native HTML5 drag-and-drop lets the user reorder panels.
 * Only one mode is active at a time. Every change is sent back to the host
 * via onChange so it is stored permanently.
 */
import { DashboardLayout, PanelSize } from '../extension-backend/domain/types';

export type LayoutMode = 'none' | 'resize' | 'move';

export interface LayoutManager {
  apply(layout: DashboardLayout): void;
  setMode(mode: LayoutMode): void;
}

const SIZE_CYCLE: PanelSize[] = ['compact', 'normal', 'tall'];

/** FLIP animation for a set of elements after DOM reorder. */
function flip(elements: HTMLElement[]): void {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const before = elements.map((el) => el.getBoundingClientRect());
  requestAnimationFrame(() => {
    elements.forEach((el, i) => {
      const after = el.getBoundingClientRect();
      const dx = (before[i]?.left ?? 0) - after.left;
      const dy = (before[i]?.top ?? 0) - after.top;
      if (dx === 0 && dy === 0) return;
      el.style.transform = `translate(${dx}px,${dy}px)`;
      el.style.transition = 'none';
      requestAnimationFrame(() => {
        el.style.transition = reduceMotion ? 'none' : 'transform 0.22s cubic-bezier(0.4,0,0.2,1)';
        el.style.transform = '';
      });
    });
  });
}

function cssPx(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function mountLayout(
  grid: HTMLElement,
  panels: Record<string, HTMLElement>,
  onChange: (layout: DashboardLayout) => void,
): LayoutManager {
  let current: DashboardLayout = [];
  let mode: LayoutMode = 'none';
  let dragId: string | null = null;

  const byId = (id: string) => current.find((p) => p.id === id);
  const emit = () => onChange(current.map((p) => ({ ...p })));

  function flash(el: HTMLElement): void {
    el.classList.add('wv-resizing');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('wv-resizing')));
  }

  function applyOne(id: string): void {
    const p = byId(id);
    const el = panels[id];
    if (!p || !el) return;
    el.dataset.span = String(p.span);
    el.dataset.size = p.size ?? 'normal';
    el.classList.toggle('wv-hidden-panel', p.hidden);
  }

  function setWidth(id: string, span: 1 | 2): void {
    const p = byId(id);
    const el = panels[id];
    if (!p || !el || p.span === span) return;
    p.span = span;
    applyOne(id);
    flash(el);
    emit();
  }

  function setSize(id: string, size: PanelSize): void {
    const p = byId(id);
    const el = panels[id];
    if (!p || !el || (p.size ?? 'normal') === size) return;
    p.size = size;
    applyOne(id);
    flash(el);
    emit();
  }

  function cycleWidth(id: string): void {
    const p = byId(id);
    if (!p) return;
    setWidth(id, p.span === 2 ? 1 : 2);
  }

  function cycleSize(id: string, dir: 1 | -1): void {
    const p = byId(id);
    if (!p) return;
    const idx = SIZE_CYCLE.indexOf(p.size ?? 'normal');
    const next = SIZE_CYCLE[Math.min(SIZE_CYCLE.length - 1, Math.max(0, idx + dir))]!;
    setSize(id, next);
  }

  function toggleHidden(id: string): void {
    const p = byId(id);
    if (!p) return;
    p.hidden = !p.hidden;
    applyOne(id);
    emit();
  }

  function reorder(from: string, to: string): void {
    const fromIdx = current.findIndex((p) => p.id === from);
    const toIdx = current.findIndex((p) => p.id === to);
    if (fromIdx < 0 || toIdx < 0) return;
    const allEls = Object.values(panels);
    flip(allEls);
    const [moved] = current.splice(fromIdx, 1);
    current.splice(toIdx, 0, moved!);
    apply(current);
    emit();
  }

  /**
   * Wires a drag handle so pointer-dragging it resizes the panel, snapping
   * to the nearest existing preset as the pointer moves. `axis` selects
   * which dimension(s) the handle controls.
   */
  function attachResizeHandle(handle: HTMLElement, id: string, axis: 'x' | 'y' | 'both'): void {
    handle.addEventListener('pointerdown', (e: PointerEvent) => {
      if (mode !== 'resize') return;
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const el = panels[id]!;
      const startRect = el.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const oneColWidth = startRect.width / (byId(id)?.span === 2 ? 2 : 1);
      const compactPx = cssPx('--wv-h-compact', 120);
      const normalPx = cssPx('--w-chart-main', 260);
      const tallPx = cssPx('--wv-h-tall', 455);

      const onMove = (ev: PointerEvent) => {
        if (axis === 'x' || axis === 'both') {
          const desiredWidth = startRect.width + (ev.clientX - startX);
          setWidth(id, desiredWidth > oneColWidth * 1.5 ? 2 : 1);
        }
        if (axis === 'y' || axis === 'both') {
          const desiredHeight = startRect.height + (ev.clientY - startY);
          const dists: Array<[PanelSize, number]> = [
            ['compact', Math.abs(desiredHeight - compactPx)],
            ['normal', Math.abs(desiredHeight - normalPx)],
            ['tall', Math.abs(desiredHeight - tallPx)],
          ];
          dists.sort((a, b) => a[1] - b[1]);
          setSize(id, dists[0]![0]);
        }
      };
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });

    // Keyboard equivalent, since dragging alone isn't accessible.
    handle.addEventListener('keydown', (e: KeyboardEvent) => {
      if (mode !== 'resize') return;
      if ((axis === 'x' || axis === 'both') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        setWidth(id, e.key === 'ArrowRight' ? 2 : 1);
      } else if ((axis === 'y' || axis === 'both') && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        cycleSize(id, e.key === 'ArrowDown' ? 1 : -1);
      }
    });
  }

  for (const [id, el] of Object.entries(panels)) {
    el.dataset.panel = id;

    const tools = document.createElement('div');
    tools.className = 'wv-panel-tools';
    tools.innerHTML = `
      <span class="wv-panel-handle" title="Drag to reorder" aria-hidden="true"><i class="codicon codicon-gripper"></i></span>
      <button class="wv-panel-btn" data-act="hide" title="Hide or show"><i class="codicon codicon-eye"></i></button>`;
    el.prepend(tools);
    tools.querySelector('[data-act="hide"]')!.addEventListener('click', () => toggleHidden(id));

    const handleRight = document.createElement('div');
    handleRight.className = 'wv-resize-handle wv-resize-handle--right';
    handleRight.tabIndex = 0;
    handleRight.setAttribute('role', 'slider');
    handleRight.setAttribute('aria-label', 'Resize panel width');
    handleRight.title = 'Drag to resize width (or use ← →)';
    attachResizeHandle(handleRight, id, 'x');

    const handleBottom = document.createElement('div');
    handleBottom.className = 'wv-resize-handle wv-resize-handle--bottom';
    handleBottom.tabIndex = 0;
    handleBottom.setAttribute('role', 'slider');
    handleBottom.setAttribute('aria-label', 'Resize panel height');
    handleBottom.title = 'Drag to resize height (or use ↑ ↓)';
    attachResizeHandle(handleBottom, id, 'y');

    const handleCorner = document.createElement('div');
    handleCorner.className = 'wv-resize-handle wv-resize-handle--corner';
    handleCorner.tabIndex = 0;
    handleCorner.setAttribute('role', 'slider');
    handleCorner.setAttribute('aria-label', 'Resize panel width and height');
    handleCorner.title = 'Drag to resize (or use arrow keys)';
    attachResizeHandle(handleCorner, id, 'both');

    el.append(handleRight, handleBottom, handleCorner);

    el.addEventListener('dragstart', (e) => {
      if (mode !== 'move') return;
      dragId = id;
      e.dataTransfer?.setData('text/plain', id);
      el.classList.add('wv-dragging');
    });
    el.addEventListener('dragend', () => {
      dragId = null;
      el.classList.remove('wv-dragging');
      for (const p of Object.values(panels)) p.classList.remove('wv-drop-target');
    });
    el.addEventListener('dragenter', () => {
      if (mode === 'move' && dragId && dragId !== id) el.classList.add('wv-drop-target');
    });
    el.addEventListener('dragleave', (e) => {
      if (!el.contains(e.relatedTarget as Node | null)) el.classList.remove('wv-drop-target');
    });
    el.addEventListener('dragover', (e) => {
      if (mode === 'move' && dragId && dragId !== id) e.preventDefault();
    });
    el.addEventListener('drop', (e) => {
      el.classList.remove('wv-drop-target');
      if (mode !== 'move' || !dragId || dragId === id) return;
      e.preventDefault();
      reorder(dragId, id);
    });

    // Click-to-cycle on the handles doubles as a quick alternative to
    // dragging (a tap without meaningful pointer movement just cycles).
    handleRight.addEventListener('click', () => { if (mode === 'resize') cycleWidth(id); });
    handleBottom.addEventListener('click', () => { if (mode === 'resize') cycleSize(id, 1); });
  }

  function apply(layout: DashboardLayout): void {
    current = layout.map((p) => ({ ...p }));
    for (const p of current) {
      const el = panels[p.id];
      if (!el) continue;
      grid.appendChild(el);
      applyOne(p.id);
    }
  }

  function setMode(next: LayoutMode): void {
    mode = next;
    grid.classList.toggle('wv-editing', mode !== 'none');
    grid.dataset.layoutMode = mode;
    for (const el of Object.values(panels)) el.draggable = mode === 'move';
  }

  return { apply, setMode };
}
