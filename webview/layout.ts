/**
 * Manages the dashboard's analysis grid: applies a persisted layout (panel
 * order, width span, visibility) and, in edit mode, lets the user drag to
 * reorder, toggle width (scaling), and show/hide panels. Every change is sent
 * back to the host via onChange so it is stored permanently.
 */
import { DashboardLayout } from '../src/domain/types';

export interface LayoutManager {
  apply(layout: DashboardLayout): void;
  setEditMode(on: boolean): void;
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
      <button class="wv-panel-btn" data-act="hide" title="Hide or show"><i class="codicon codicon-eye"></i></button>`;
    el.prepend(tools);
    tools.querySelector('[data-act="width"]')!.addEventListener('click', () => toggleWidth(id));
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
    });
    el.addEventListener('dragover', (e) => {
      if (editing && dragId && dragId !== id) e.preventDefault();
    });
    el.addEventListener('drop', (e) => {
      if (!editing || !dragId || dragId === id) return;
      e.preventDefault();
      reorder(dragId, id);
    });
  }

  const byId = (id: string) => current.find((p) => p.id === id);
  const emit = () => onChange(current.map((p) => ({ ...p })));

  function applyOne(id: string): void {
    const p = byId(id);
    const el = panels[id];
    if (!p || !el) return;
    el.dataset.span = String(p.span);
    el.classList.toggle('wv-hidden-panel', p.hidden);
  }

  function toggleWidth(id: string): void {
    const p = byId(id);
    if (!p) return;
    p.span = p.span === 2 ? 1 : 2;
    applyOne(id);
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
      grid.appendChild(el); // re-append in layout order
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
