/**
 * Manages the dashboard's analysis grid: applies a persisted layout (panel
 * order, width span, size, visibility) and, in edit mode, lets the user drag to
 * reorder, toggle width/height, and show/hide panels. Every change is sent
 * back to the host via onChange so it is stored permanently.
 */
import { DashboardLayout, PanelSize } from '../src/domain/types';

export interface LayoutManager {
  apply(layout: DashboardLayout): void;
  setEditMode(on: boolean): void;
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

export function mountLayout(
  grid: HTMLElement,
  panels: Record<string, HTMLElement>,
  onChange: (layout: DashboardLayout) => void,
): LayoutManager {
  let current: DashboardLayout = [];
  let editing = false;
  let dragId: string | null = null;

  for (const [id, el] of Object.entries(panels)) {
    el.dataset.panel = id;

    const tools = document.createElement('div');
    tools.className = 'wv-panel-tools';
    tools.innerHTML = `
      <span class="wv-panel-handle" title="Drag to reorder" aria-hidden="true"><i class="codicon codicon-gripper"></i></span>
      <button class="wv-panel-btn" data-act="width" title="Toggle width"><i class="codicon codicon-screen-full"></i></button>
      <button class="wv-panel-btn" data-act="size" title="Cycle height (compact / normal / tall)"><i class="codicon codicon-arrow-both"></i></button>
      <button class="wv-panel-btn" data-act="hide" title="Hide or show"><i class="codicon codicon-eye"></i></button>`;
    el.prepend(tools);
    tools.querySelector('[data-act="width"]')!.addEventListener('click', () => toggleWidth(id));
    tools.querySelector('[data-act="size"]')!.addEventListener('click', () => toggleSize(id));
    tools.querySelector('[data-act="hide"]')!.addEventListener('click', () => toggleHidden(id));

    el.addEventListener('dragstart', (e) => {
      if (!editing) return;
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
      if (editing && dragId && dragId !== id) el.classList.add('wv-drop-target');
    });
    el.addEventListener('dragleave', (e) => {
      if (!el.contains(e.relatedTarget as Node | null)) el.classList.remove('wv-drop-target');
    });
    el.addEventListener('dragover', (e) => {
      if (editing && dragId && dragId !== id) e.preventDefault();
    });
    el.addEventListener('drop', (e) => {
      el.classList.remove('wv-drop-target');
      if (!editing || !dragId || dragId === id) return;
      e.preventDefault();
      reorder(dragId, id);
    });
  }

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

  function toggleWidth(id: string): void {
    const p = byId(id);
    const el = panels[id];
    if (!p || !el) return;
    p.span = p.span === 2 ? 1 : 2;
    applyOne(id);
    flash(el);
    emit();
  }

  function toggleSize(id: string): void {
    const p = byId(id);
    const el = panels[id];
    if (!p || !el) return;
    const idx = SIZE_CYCLE.indexOf(p.size ?? 'normal');
    p.size = SIZE_CYCLE[(idx + 1) % SIZE_CYCLE.length]!;
    applyOne(id);
    flash(el);
    emit();
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

  function apply(layout: DashboardLayout): void {
    current = layout.map((p) => ({ ...p }));
    for (const p of current) {
      const el = panels[p.id];
      if (!el) continue;
      grid.appendChild(el);
      applyOne(p.id);
    }
  }

  function setEditMode(on: boolean): void {
    editing = on;
    grid.classList.toggle('wv-editing', on);
    for (const el of Object.values(panels)) el.draggable = on;
  }

  return { apply, setEditMode };
}
