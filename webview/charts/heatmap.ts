/**
 * Calendar heatmap — 12 weeks of daily credit usage.
 * Consumes pre-computed HeatmapData from the host.
 * Only rendered when there is at least one non-zero day.
 */
import { initChart } from './echarts';
import type { TooltipComponentOption } from './echarts';
import { readTheme } from '../theme';
import { UsageSnapshot } from '../../src/domain/types';
import { formatCredits } from '../../src/domain/format';

export interface HeatmapHandle {
  update(snapshot: UsageSnapshot): void;
  resize(): void;
}

export function mountHeatmap(el: HTMLElement): HeatmapHandle {
  const chart = initChart(el);

  return {
    update(s: UsageSnapshot) {
      const { cells, max } = s.chartData.heatmap;
      if (max === 0) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      const t = readTheme();

      const rangeStart = cells[0]?.date ?? '';
      const rangeEnd = cells[cells.length - 1]?.date ?? '';

      chart.setOption(
        {
          animation: false,
          tooltip: {
            formatter(params: TooltipComponentOption) {
              const p = params as unknown as { value: [string, number] };
              const [date, credits] = p.value;
              return `${date}<br/>${formatCredits(credits)} cr`;
            },
          },
          visualMap: {
            show: false,
            min: 0,
            max,
            // duotone ramp: faint gray (light usage) → mid gray → Swiss red.
            inRange: {
              color: [t.series[5] ?? t.muted, t.series[3] ?? t.muted, t.accent],
            },
          },
          calendar: {
            range: [rangeStart, rangeEnd],
            cellSize: [14, 14],
            itemStyle: { borderWidth: 1, borderColor: t.border },
            yearLabel: { show: false },
            monthLabel: { fontSize: 10 },
            dayLabel: { fontSize: 9, firstDay: 1 },
          },
          series: [
            {
              type: 'heatmap',
              coordinateSystem: 'calendar',
              data: cells.map((c) => [c.date, c.value]),
            },
          ],
        },
        { notMerge: false, lazyUpdate: true },
      );
    },

    resize() {
      chart.resize();
    },
  };
}
