function cssVar(name: string, fallback = ''): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export interface WeevilTheme {
  bg: string;
  card: string;
  fg: string;
  muted: string;
  border: string;
  series: string[];
  tooltipBg: string;
  labelFont: string;
}

export function readTheme(): WeevilTheme {
  return {
    bg: cssVar('--vscode-editor-background', '#1e1e1e'),
    card: cssVar('--vscode-sideBar-background', '#252526'),
    fg: cssVar('--vscode-editor-foreground', '#cccccc'),
    muted: cssVar('--vscode-descriptionForeground', '#858585'),
    border: cssVar('--vscode-panel-border', '#3c3c3c'),
    tooltipBg: cssVar('--vscode-editorHoverWidget-background', '#2d2d2d'),
    // Monospace technical labels, matching the dashboard's field-guide voice.
    labelFont: cssVar('--vscode-editor-font-family', 'monospace'),
    // Flat OP-Z primary palette — saturated, no gradients, reads on light and
    // dark editor themes alike.
    series: ['#2F9BE8', '#4FC23A', '#FFC400', '#FF453A', '#FF4F8B', '#FE5000'],
  };
}

export function buildEChartsTheme(t: WeevilTheme): Record<string, any> {
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
