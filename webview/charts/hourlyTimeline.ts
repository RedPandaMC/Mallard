/**
 * Usage by hour-of-day — 24-bar chart showing credits binned on each hour.
 * Helps developers see whether spend peaks at standups, late-night sessions, etc.
 * Peak hour is highlighted in the theme accent; all others stay grayscale.
 */
import { initChart } from './echarts';
import type { TooltipComponentOption } from './echarts';
import { readTheme } from '../theme';
import { UsageSnapshot } from '../../src/domain/types';
import { formatCredits } from '../../src/domain/format';

export interface HourlyTimelineHandle {
  update(snapshot: UsageSnapshot): void;
  resize(): void;
}

export function mountHourlyTimeline(el: HTMLElement): HourlyTimelineHandle {
  const chart = initChart(el);

  return {
    update(s: UsageSnapshot) {
      const { hours, peakHour } = s.chartData.hourlyTimeline;
      if (hours.every((v) => v === 0)) {
        chart.clear();
        return;
      }
      const t = readTheme();

      const labels = hours.map((_, i) => (i % 6 === 0 ? `${i}h` : ''));
      const data = hours.map((v, i) => ({
        value: Math.round(v * 100) / 100,
        itemStyle: {
          color: i === peakHour ? t.accent : (t.series[3] ?? t.muted),
          borderColor: t.border,
          borderWidth: t.highContrast ? 1 : 0,
        },
      }));

      chart.setOption(
        {
          animation: false,
          tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter(params: TooltipComponentOption) {
              const p = (params as unknown as Array<{ dataIndex: number; value: number }>)[0];
              if (!p) return '';
              return `${p.dataIndex}:00 – ${p.dataIndex + 1}:00<br/>${formatCredits(p.value)} cr`;
            },
          },
          grid: { left: 36, right: 12, top: 8, bottom: 20 },
          xAxis: {
            type: 'category',
            data: labels,
            axisLabel: { fontSize: 10 },
            axisTick: { show: false },
          },
          yAxis: {
            type: 'value',
            axisLabel: { show: false },
            splitLine: { lineStyle: { color: t.border, opacity: 0.4 } },
          },
          series: [{ type: 'bar', data, barMaxWidth: 18 }],
        },
        { notMerge: true, lazyUpdate: true },
      );
    },

    resize() {
      chart.resize();
    },
  };
}
