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
}

export function readTheme(): WeevilTheme {
  return {
    bg: cssVar('--vscode-editor-background', '#1e1e1e'),
    card: cssVar('--vscode-sideBar-background', '#252526'),
    fg: cssVar('--vscode-editor-foreground', '#cccccc'),
    muted: cssVar('--vscode-descriptionForeground', '#858585'),
    border: cssVar('--vscode-panel-border', '#3c3c3c'),
    tooltipBg: cssVar('--vscode-editorHoverWidget-background', '#2d2d2d'),
    series: [
      cssVar('--vscode-charts-blue', '#4FC3F7'),
      cssVar('--vscode-charts-orange', '#FFB74D'),
      cssVar('--vscode-charts-purple', '#CE93D8'),
      cssVar('--vscode-charts-red', '#EF9A9A'),
      cssVar('--vscode-charts-green', '#A5D6A7'),
      cssVar('--vscode-charts-yellow', '#FFF176'),
    ],
  };
}

export function buildEChartsTheme(t: WeevilTheme): Record<string, any> {
  return {
    backgroundColor: 'transparent',
    textStyle: { color: t.fg, fontSize: 12 },
    title: { textStyle: { color: t.fg }, subtextStyle: { color: t.muted } },
    legend: { textStyle: { color: t.fg } },
    tooltip: {
      backgroundColor: t.tooltipBg,
      borderColor: t.border,
      textStyle: { color: t.fg, fontSize: 12 },
    },
    color: t.series,
    categoryAxis: {
      axisLine: { lineStyle: { color: t.border } },
      axisTick: { lineStyle: { color: t.border } },
      axisLabel: { color: t.muted },
      splitLine: { lineStyle: { color: t.border } },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: t.muted },
      splitLine: { lineStyle: { color: t.border, type: 'dashed' } },
    },
  };
}
