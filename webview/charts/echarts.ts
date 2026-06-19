import * as echarts from 'echarts';
import { buildEChartsTheme, readTheme } from '../theme';

const THEME = 'mallard';

export function applyTheme(): void {
  echarts.registerTheme(THEME, buildEChartsTheme(readTheme()));
}

export function initChart(el: HTMLElement): echarts.ECharts {
  return echarts.init(el, THEME, { renderer: 'canvas' });
}

export { echarts };
