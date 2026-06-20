import * as echarts from 'echarts/core';
import { BarChart, LineChart, HeatmapChart, SankeyChart, PieChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CalendarComponent,
  VisualMapComponent,
  MarkLineComponent,
  PolarComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

// Type-only imports from the full package — zero runtime cost, enables type checking.
export type {
  EChartsOption,
  TooltipComponentOption,
  SeriesOption,
} from 'echarts';

import { buildEChartsTheme, readTheme } from '../theme';

echarts.use([
  BarChart,
  LineChart,
  HeatmapChart,
  SankeyChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CalendarComponent,
  VisualMapComponent,
  MarkLineComponent,
  PolarComponent,
  CanvasRenderer,
]);

const THEME = 'mallard';

export function applyTheme(): void {
  echarts.registerTheme(THEME, buildEChartsTheme(readTheme()));
}

export function initChart(el: HTMLElement): echarts.EChartsType {
  return echarts.init(el, THEME, { renderer: 'canvas' });
}

export { echarts };
