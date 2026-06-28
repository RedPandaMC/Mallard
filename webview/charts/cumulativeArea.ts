/**
 * Cumulative spend — a running total of daily cost across the window,
 * with the monthly budget drawn as a reference line.
 * The running total is pre-computed on the host (cumulativeCosts).
 */
import type { TooltipComponentOption } from './echarts';
import { readTheme } from '../theme';
import { UsageSnapshot } from '../../src/domain/types';
import { formatMoney } from '../../src/domain/format';
import { ChartComponent } from './ChartComponent';

export interface CumulativeAreaHandle {
  update(snapshot: UsageSnapshot): void;
  resize(): void;
}

class CumulativeAreaChart extends ChartComponent {
  protected hasData(s: UsageSnapshot): boolean {
    return s.chartData.dailyBars.points.length > 0;
  }

  protected buildOption(s: UsageSnapshot): object {
    const { points, cumulativeCosts } = s.chartData.dailyBars;
    const t = readTheme();
    const currency = s.currency;
    const budget = s.budget.monthly && s.budget.monthly > 0 ? s.budget.monthly : null;

    return {
      animation: false,
      tooltip: {
        trigger: 'axis',
        formatter(params: TooltipComponentOption) {
          const p = (params as unknown as Array<{ dataIndex: number }>)[0];
          if (!p) return '';
          const date = points[p.dataIndex]?.date ?? '';
          return `<strong>${date}</strong><br/>${formatMoney(cumulativeCosts[p.dataIndex] ?? 0, currency)} cumulative`;
        },
      },
      grid: { left: 44, right: 16, top: 14, bottom: 28, containLabel: false },
      xAxis: {
        type: 'category',
        data: points.map((p) => p.date),
        boundaryGap: false,
        axisLabel: { fontSize: 10, interval: 6 },
      },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 10, formatter: (v: number) => formatMoney(v, currency) },
      },
      series: [
        {
          type: 'line',
          name: 'Cumulative spend',
          data: cumulativeCosts,
          smooth: true,
          showSymbol: false,
          lineStyle: { color: t.accent, width: 2.4 },
          areaStyle: { color: t.accent, opacity: 0.16 },
          emphasis: { focus: 'none' },
          ...(budget !== null
            ? {
                markLine: {
                  silent: true,
                  symbol: 'none',
                  label: {
                    formatter: `budget ${formatMoney(budget, currency)}`,
                    fontSize: 10,
                    color: t.sevWarn,
                    position: 'insideEndTop',
                  },
                  lineStyle: { color: t.sevWarn, type: 'dashed', width: 1.4 },
                  data: [{ yAxis: budget }],
                },
              }
            : {}),
        },
      ],
    };
  }
}

export function mountCumulativeArea(el: HTMLElement): CumulativeAreaHandle {
  return new CumulativeAreaChart(el);
}
