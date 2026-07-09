/**
 * Cost categories over time — stacked area of per-day input/output/cache/
 * thinking/tool cost. The single-period category donut answers "what mix";
 * this answers "how is the mix shifting".
 */
import type { TooltipComponentOption } from './echarts';
import { readTheme } from '../theme';
import { UsageSnapshot } from '../../extension-backend/domain/types';
import { formatMoney } from '../../extension-backend/domain/format';
import { ChartComponent } from './ChartComponent';

const CATEGORY_LABELS: Record<string, string> = {
  input: 'Input',
  output: 'Output',
  cache_read: 'Cache read',
  cache_creation: 'Cache write',
  thinking: 'Thinking',
  tool: 'Tool',
  unknown: 'Other',
};

export interface CategoryTrendHandle {
  update(snapshot: UsageSnapshot): void;
  resize(): void;
  reinit(): void;
}

class CategoryTrendChart extends ChartComponent {
  protected hasData(s: UsageSnapshot): boolean {
    return s.chartData.categoryTrend.available;
  }

  protected buildOption(s: UsageSnapshot): object {
    const t = readTheme();
    const { dates, series } = s.chartData.categoryTrend;
    const currency = s.currency || 'USD';
    // Fixed hue assignment by category identity (never by rank): the accent
    // carries the first category, the grayscale ramp the rest.
    const palette = [t.accent, ...t.series];
    return {
      animation: false,
      tooltip: {
        trigger: 'axis',
        formatter(params: TooltipComponentOption) {
          const rows = params as unknown as Array<{ seriesName: string; value: number; axisValue: string }>;
          if (!rows.length) return '';
          const lines = rows
            .filter((r) => r.value > 0)
            .map((r) => `${r.seriesName}: ${formatMoney(r.value, currency)}`);
          return `${rows[0]!.axisValue}<br/>${lines.join('<br/>')}`;
        },
      },
      legend: {
        bottom: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 10 },
      },
      grid: { left: 40, right: 12, top: 8, bottom: 34 },
      xAxis: {
        type: 'category',
        data: dates,
        boundaryGap: false,
        axisLabel: { fontSize: 10, interval: 6 },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 10 },
        splitLine: { lineStyle: { color: t.border, opacity: 0.4 } },
      },
      series: series.map((sr, i) => ({
        name: CATEGORY_LABELS[sr.category] ?? sr.category,
        type: 'line',
        stack: 'cost',
        areaStyle: { opacity: 0.55 },
        lineStyle: { width: 1 },
        showSymbol: false,
        emphasis: { focus: 'series' },
        color: palette[i % palette.length],
        data: sr.costs.map((v) => Math.round(v * 10000) / 10000),
      })),
    };
  }
}

export function mountCategoryTrend(el: HTMLElement): CategoryTrendHandle {
  return new CategoryTrendChart(el);
}
