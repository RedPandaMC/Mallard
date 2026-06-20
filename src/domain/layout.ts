/**
 * Pure helpers for the dashboard layout. Kept free of vscode/DOM so they can be
 * shared and unit-tested.
 */
import {
  ConfigDashboard,
  ConfigPanelLayout,
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

/**
 * Parse a CSS grid-column shorthand like "span 2" into a span integer (1 or 2).
 * Anything that doesn't match "span N" defaults to 1.
 */
export function gridColumnToSpan(gridColumn: string | undefined): 1 | 2 {
  if (!gridColumn) return 1;
  const m = /^span\s+(\d+)$/i.exec(gridColumn.trim());
  if (!m) return 1;
  return parseInt(m[1]!, 10) >= 2 ? 2 : 1;
}

/**
 * Merge a config-file `dashboard` block into a globalState layout.
 *
 * Priority: config-declared panels (order + sizing + hidden) take precedence.
 * Panels not mentioned in config fall back to the globalState layout, then to
 * DEFAULT_DASHBOARD_LAYOUT. Unknown panel ids in config are silently dropped.
 */
export function mergeConfigLayout(
  config: ConfigDashboard | undefined,
  stored: DashboardLayout,
): DashboardLayout {
  if (!config?.panels?.length) return normalizeLayout(stored);

  const known = new Set<string>(DASHBOARD_PANELS);
  const seen = new Set<string>();
  const storedById = new Map(stored.map((p) => [p.id, p]));
  const defaultById = new Map(DEFAULT_DASHBOARD_LAYOUT.map((p) => [p.id, p]));
  const out: DashboardPanelLayout[] = [];

  const configPanels: ConfigPanelLayout[] = config.panels.filter((p) => known.has(p.id));

  for (const cp of configPanels) {
    if (seen.has(cp.id)) continue;
    seen.add(cp.id);
    const fallback = storedById.get(cp.id) ?? defaultById.get(cp.id);
    out.push({
      id: cp.id,
      span: cp.gridColumn !== undefined ? gridColumnToSpan(cp.gridColumn) : (fallback?.span ?? 1),
      hidden: cp.hidden !== undefined ? cp.hidden : (fallback?.hidden ?? false),
    });
  }

  // Append panels not covered by config (globalState order, then defaults).
  const remaining = normalizeLayout(stored).filter((p) => !seen.has(p.id));
  for (const p of remaining) {
    out.push(p);
  }

  return out;
}
