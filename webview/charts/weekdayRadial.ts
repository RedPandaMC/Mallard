/**
 * Usage by weekday — credits binned onto a radial bar chart, so weekly rhythm
 * (heavy weekdays, light weekends) reads at a glance. Webview-only: binned
 * from the calendar HeatmapData the host already sends (full YYYY-MM-DD dates).
 */
import { echarts, initChart } from './echarts';
import { readTheme } from '../theme';
import { UsageSnapshot } from '../../src/domain/types';
import { formatCredits } from '../../src/domain/format';

export interface WeekdayRadialHandle {
  update(snapshot: UsageSnapshot): void;
  resize(): void;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function mountWeekdayRadial(el: HTMLElement): WeekdayRadialHandle {
  const chart = initChart(el);

  return {
    update(s: UsageSnapshot) {
      const { cells, max } = s.chartData.heatmap;
      if (max === 0 || cells.length === 0) {
        chart.clear();
        return;
      }
      const t = readTheme();

      const totals = new Array(7).fill(0) as number[];
      for (const c of cells) {
        const d = new Date(`${c.date}T00:00:00`);
        if (Number.isNaN(d.getTime())) continue;
        const idx = (d.getDay() + 6) % 7; // shift so Monday = 0
        totals[idx]! += c.value;
      }

      // Highlight the busiest weekday in the accent; the rest stay grayscale —
      // duotone, and (with the angle-axis labels) readable without colour.
      const peak = totals.indexOf(Math.max(...totals));
      const data = totals.map((v, i) => ({
        value: Math.round(v),
        itemStyle: {
          color: i === peak ? t.accent : (t.series[3] ?? t.muted),
          borderColor: t.border,
          borderWidth: t.highContrast ? 1 : 0,
        },
      }));

      chart.setOption(
        {
          animation: false,
          tooltip: {
            trigger: 'item',
            formatter(p: echarts.TooltipComponentOption) {
              const item = p as unknown as { name: string; value: number };
              return `${item.name}<br/>${formatCredits(item.value)} cr`;
            },
          },
          polar: { radius: ['18%', '78%'] },
          angleAxis: {
            type: 'category',
            data: DAYS,
            startAngle: 90,
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { fontSize: 10 },
          },
          radiusAxis: {
            axisLabel: { show: false },
            axisLine: { show: false },
            axisTick: { show: false },
            splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
          },
          series: [
            {
              type: 'bar',
              coordinateSystem: 'polar',
              data,
              roundCap: true,
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
