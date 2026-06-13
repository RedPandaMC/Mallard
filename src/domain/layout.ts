/**
 * Pure helpers for the dashboard layout. Kept free of vscode/DOM so they can be
 * shared and unit-tested.
 */
import {
  DASHBOARD_PANELS,
  DashboardLayout,
  DashboardPanelLayout,
  DEFAULT_DASHBOARD_LAYOUT,
} from './types';

/**
 * Keep stored entries (preserving their order/span/hidden), drop unknown panel
 * ids and duplicates, and append any panels missing from the stored layout
 * using defaults. This makes saved layouts forward/backward compatible when the
 * panel set changes between versions.
 */
export function normalizeLayout(stored?: DashboardLayout): DashboardLayout {
  const known = new Set<string>(DASHBOARD_PANELS);
  const seen = new Set<string>();
  const out: DashboardPanelLayout[] = [];

  for (const p of stored ?? []) {
    if (!p || !known.has(p.id) || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ id: p.id, span: p.span === 2 ? 2 : 1, hidden: Boolean(p.hidden) });
  }
  for (const def of DEFAULT_DASHBOARD_LAYOUT) {
    if (!seen.has(def.id)) out.push({ ...def });
  }
  return out;
}
