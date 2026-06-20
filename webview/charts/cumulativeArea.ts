/**
 * Cumulative spend — a running total of daily cost across the 30-day window,
 * with the monthly budget drawn as a reference line. Webview-only: derived
 * from the same DailyBarsData the host already sends.
 */
import { initChart } from './echarts';
import type { TooltipComponentOption } from './echarts';
import { readTheme } from '../theme';
import { UsageSnapshot } from '../../src/domain/types';
import { formatMoney } from '../../src/domain/format';

export interface CumulativeAreaHandle {
  update(snapshot: UsageSnapshot): void;
  resize(): void;
}

export function mountCumulativeArea(el: HTMLElement): CumulativeAreaHandle {
  const chart = initChart(el);

  return {
    update(s: UsageSnapshot) {
      const { points } = s.chartData.dailyBars;
      if (points.length === 0) {
        chart.clear();
        return;
      }
      const t = readTheme();
      const currency = s.currency;

      let running = 0;
      const cumulative = points.map((p) => {
        running += p.cost;
        return running;
      });
      const budget = s.budget.monthly && s.budget.monthly > 0 ? s.budget.monthly : null;

      chart.setOption(
        {
          animation: false,
          tooltip: {
            trigger: 'axis',
            formatter(params: TooltipComponentOption) {
              const p = (params as unknown as Array<{ dataIndex: number }>)[0];
              if (!p) return '';
              const date = points[p.dataIndex]?.date ?? '';
              return `<strong>${date}</strong><br/>${formatMoney(cumulative[p.dataIndex] ?? 0, currency)} cumulative`;
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
              data: cumulative,
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
        },
        { notMerge: true, lazyUpdate: true },
      );
    },

    resize() {
      chart.resize();
    },
  };
}
