/* c8 ignore next */
/**
 * Pure helpers for the dashboard layout. Kept free of vscode/DOM so they can be
 * shared and unit-tested.
 */
import {
  ConfigPanelLayout,
  DASHBOARD_PANELS,
  DashboardLayout,
  DashboardPanelLayout,
  DEFAULT_DASHBOARD_LAYOUT,
  MAX_PANEL_SPAN,
  PanelSize,
} from './types';

const VALID_SIZES = new Set<PanelSize>(['compact', 'normal', 'tall']);
function validSize(s: unknown): PanelSize | undefined {
  return VALID_SIZES.has(s as PanelSize) ? (s as PanelSize) : undefined;
}

/** Clamp a stored span to a valid integer in [1, MAX_PANEL_SPAN]. */
function validSpan(s: unknown): number {
  const n = Math.round(Number(s));
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_PANEL_SPAN, Math.max(1, n));
}

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
    out.push({ id: p.id, span: validSpan(p.span), hidden: Boolean(p.hidden), size: validSize(p.size) ?? 'normal' });
  }
  for (const def of DEFAULT_DASHBOARD_LAYOUT) {
    if (!seen.has(def.id)) out.push({ ...def });
  }
  return out;
}

/**
 * Parse a CSS grid-column shorthand like "span 3" into a span integer in
 * [1, MAX_PANEL_SPAN]. Anything that doesn't match "span N" defaults to 1.
 */
export function gridColumnToSpan(gridColumn: string | undefined): number {
  if (!gridColumn) return 1;
  const m = /^span\s+(\d+)$/i.exec(gridColumn.trim());
  if (!m) return 1;
  return validSpan(parseInt(m[1]!, 10));
}

/**
 * Convert the config.json `dashboard.panels` block into a DashboardLayout.
 * Unknown ids and duplicates are dropped and missing panels appended by
 * {@link normalizeLayout}, so a hand-edited file can never break the grid.
 */
export function configPanelsToLayout(panels: ConfigPanelLayout[] | undefined): DashboardLayout {
  const raw: DashboardPanelLayout[] = (panels ?? []).map((p) => ({
    id: p.id,
    span: p.gridColumn !== undefined ? gridColumnToSpan(p.gridColumn) : 1,
    hidden: Boolean(p.hidden),
    size: validSize(p.size) ?? 'normal',
  }));
  return normalizeLayout(raw);
}

/**
 * Serialize a DashboardLayout into the config.json `dashboard.panels` shape,
 * omitting values that match the defaults so the file stays readable.
 */
export function layoutToConfigPanels(layout: DashboardLayout): ConfigPanelLayout[] {
  return normalizeLayout(layout).map((p) => ({
    id: p.id,
    gridColumn: `span ${p.span}`,
    ...(p.hidden ? { hidden: true } : {}),
    ...(p.size && p.size !== 'normal' ? { size: p.size } : {}),
  }));
}
