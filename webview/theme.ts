import { deriveAccent, ensureContrast, parseColor, toHex } from './color';
import type { PaletteMode } from '../src/domain/types';
import type { ThemeKind } from '../src/ui/messaging';

function cssVar(name: string, fallback = ''): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * Resolve the dashboard accent for the active palette mode and theme, set it on
 * the document root, and run it through the accessibility checks — for BOTH
 * modes, not just the theme-derived one:
 * - `swiss`: the fixed Swiss red, nudged for contrast if an unusual editor
 *   theme would make it illegible against the surface.
 * - `theme`: derived from the VS Code accent (button / link), with contrast +
 *   colour-blindness validation (see webview/color.ts).
 * Everything keyed off --w-accent (series, severity, brand) follows.
 */
export function applyPalette(palette: PaletteMode, kind: ThemeKind): void {
  const root = document.documentElement;
  const bgStr = cssVar('--vscode-editor-background', '#1e1e1e');
  const bg = parseColor(bgStr) ?? { r: 30, g: 30, b: 30 };
  const light = kind === 'light' || kind === 'high-contrast-light';
  const baseRed = light ? '#e5231b' : '#ff453a';

  let accent: string;
  if (palette === 'theme') {
    const seed =
      cssVar('--vscode-button-background') || cssVar('--vscode-textLink-foreground') || baseRed;
    accent = deriveAccent(seed, bgStr, baseRed);
  } else {
    accent = toHex(ensureContrast(parseColor(baseRed)!, bg, 3));
  }
  root.style.setProperty('--w-accent', accent);
}

export interface MallardTheme {
  bg: string;
  card: string;
  fg: string;
  muted: string;
  border: string;
  series: string[];
  accent: string;
  sevOk: string;
  sevWarn: string;
  sevOver: string;
  tooltipBg: string;
  labelFont: string;
  highContrast: boolean;
}

/** Read a duotone token, resolving the back-compat var chain to a concrete
 *  colour. getComputedStyle resolves color-mix()/var() to rgb() for us. */
function seriesColors(): string[] {
  const fallback = ['#ff453a', '#d6d6d6', '#9a9a9a', '#6e6e6e', '#b7b7b7', '#4f4f4f'];
  return fallback.map((fb, i) => cssVar(`--w-series-${i + 1}`, fb));
}

export function readTheme(): MallardTheme {
  const body = document.body.classList;
  return {
    bg: cssVar('--vscode-editor-background', '#1e1e1e'),
    card: cssVar('--vscode-sideBar-background', '#252526'),
    fg: cssVar('--vscode-editor-foreground', '#cccccc'),
    muted: cssVar('--vscode-descriptionForeground', '#858585'),
    border: cssVar('--vscode-panel-border', '#3c3c3c'),
    tooltipBg: cssVar('--vscode-editorHoverWidget-background', '#2d2d2d'),
    // IBM Plex Mono technical labels (bundled); falls back to the editor mono.
    labelFont: cssVar('--w-label-font', "'IBM Plex Mono', monospace"),
    // Strict duotone: red accent first, then a grayscale ramp derived from the
    // theme foreground, so charts read black-and-white with a single accent.
    series: seriesColors(),
    accent: cssVar('--w-accent', '#ff453a'),
    sevOk: cssVar('--w-sev-ok', '#9e9e9e'),
    sevWarn: cssVar('--w-sev-warn', '#ff8a80'),
    sevOver: cssVar('--w-sev-over', '#ff453a'),
    highContrast:
      body.contains('vscode-high-contrast') || body.contains('vscode-high-contrast-light'),
  };
}

export function buildEChartsTheme(t: MallardTheme): Record<string, any> {
  const axisLabel = { color: t.muted, fontFamily: t.labelFont, fontSize: 11 };
  return {
    backgroundColor: 'transparent',
    textStyle: { color: t.fg, fontFamily: t.labelFont, fontSize: 12 },
    title: { textStyle: { color: t.fg }, subtextStyle: { color: t.muted } },
    legend: { textStyle: { color: t.fg, fontFamily: t.labelFont } },
    tooltip: {
      backgroundColor: t.tooltipBg,
      borderColor: t.border,
      textStyle: { color: t.fg, fontSize: 12 },
    },
    color: t.series,
    categoryAxis: {
      axisLine: { lineStyle: { color: t.border } },
      axisTick: { lineStyle: { color: t.border } },
      axisLabel,
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel,
      splitLine: { lineStyle: { color: t.border, type: 'dashed' } },
    },
  };
}
