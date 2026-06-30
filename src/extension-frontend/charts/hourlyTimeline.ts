/**
 * Usage by hour-of-day — 24-bar chart showing credits binned on each hour.
 * Helps developers see whether spend peaks at standups, late-night sessions, etc.
 * Peak hour is highlighted in the theme accent; all others stay grayscale.
 */
import type { TooltipComponentOption } from './echarts';
import { readTheme } from '../theme';
import { UsageSnapshot } from '../../extension-backend/domain/types';
import { formatCredits } from '../../extension-backend/domain/format';
import { ChartComponent } from './ChartComponent';

export interface HourlyTimelineHandle {
  update(snapshot: UsageSnapshot): void;
  resize(): void;
}

class HourlyTimelineChart extends ChartComponent {
  protected hasData(s: UsageSnapshot): boolean {
    return s.chartData.hourlyTimeline.hours.some((v) => v !== 0);
  }

  protected buildOption(s: UsageSnapshot): object {
    const { hours, peakHour } = s.chartData.hourlyTimeline;
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
    return {
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
    };
  }
}

export function mountHourlyTimeline(el: HTMLElement): HourlyTimelineHandle {
  return new HourlyTimelineChart(el);
}
