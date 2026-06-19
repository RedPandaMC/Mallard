/**
 * 30-day daily bar chart — consumes pre-computed DailyBarsData from the host.
 */
import { echarts, initChart } from './echarts';
import { readTheme } from '../theme';
import { UsageSnapshot } from '../../src/domain/types';
import { formatMoney, formatCredits } from '../../src/domain/format';

export interface DailyBarsHandle {
  update(snapshot: UsageSnapshot): void;
  resize(): void;
}

export function mountDailyBars(el: HTMLElement): DailyBarsHandle {
  const chart = initChart(el);

  return {
    update(s: UsageSnapshot) {
      const { points, budgetLine, projectedLine } = s.chartData.dailyBars;
      const currency = s.currency;
      const t = readTheme();
      // colorIndex 0/1/2 → severity ramp gray → coral → red (duotone).
      const sev = [t.sevOk, t.sevWarn, t.sevOver];

      const series: echarts.SeriesOption[] = [
        {
          type: 'bar',
          name: 'Credits',
          data: points.map((p) => ({
            value: p.credits,
            itemStyle: { color: sev[p.colorIndex] ?? t.sevOk },
          })),
          emphasis: { itemStyle: { opacity: 0.85 } },
        },
      ];

      if (budgetLine !== null) {
        series.push({
          type: 'line',
          name: 'Daily budget',
          data: points.map(() => budgetLine),
          lineStyle: { type: 'dashed', color: t.sevWarn, width: 1 },
          symbol: 'none',
          silent: true,
        } as echarts.SeriesOption);
      }

      if (projectedLine !== null) {
        series.push({
          type: 'line',
          name: 'Projected pace',
          data: points.map(() => projectedLine),
          lineStyle: { type: 'dotted', color: t.accent, width: 1.5 },
          symbol: 'none',
          silent: true,
        } as echarts.SeriesOption);
      }

      chart.setOption(
        {
          animation: false,
          tooltip: {
            trigger: 'axis',
            formatter(params: echarts.TooltipComponentOption) {
              const p = (params as unknown as Array<{ dataIndex: number }>)[0];
              if (!p) return '';
              const pt = points[p.dataIndex];
              if (!pt) return '';
              return [
                `<strong>${pt.date}</strong>`,
                `${formatCredits(pt.credits)} cr`,
                formatMoney(pt.cost, currency),
              ].join('<br/>');
            },
          },
          grid: { left: 40, right: 16, top: 12, bottom: 40, containLabel: false },
          xAxis: {
            type: 'category',
            data: points.map((p) => p.date),
            axisLabel: { rotate: 45, fontSize: 10, interval: 4 },
          },
          yAxis: { type: 'value', name: 'Credits', nameTextStyle: { fontSize: 10 } },
          series,
          legend: {
            show: series.length > 1,
            top: 0,
            right: 0,
            itemWidth: 14,
            itemHeight: 8,
            textStyle: { fontSize: 11 },
          },
        },
        { notMerge: false, lazyUpdate: true },
      );
    },

    resize() {
      chart.resize();
    },
  };
}
