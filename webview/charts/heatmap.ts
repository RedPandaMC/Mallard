/**
 * Calendar heatmap — 12 weeks of daily credit usage.
 * Consumes pre-computed HeatmapData from the host.
 * Only rendered when there is at least one non-zero day.
 */
import { echarts, initChart } from './echarts';
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

      const rangeStart = cells[0]?.date ?? '';
      const rangeEnd = cells[cells.length - 1]?.date ?? '';

      chart.setOption(
        {
          animation: false,
          tooltip: {
            formatter(params: echarts.TooltipComponentOption) {
              const p = params as unknown as { value: [string, number] };
              const [date, credits] = p.value;
              return `${date}<br/>${formatCredits(credits)} cr`;
            },
          },
          visualMap: {
            show: false,
            min: 0,
            max,
            inRange: {
              color: [
                'var(--vscode-charts-lines, #404040)',
                'var(--vscode-charts-green, #81C784)',
                'var(--vscode-charts-blue, #4FC3F7)',
              ],
            },
          },
          calendar: {
            range: [rangeStart, rangeEnd],
            cellSize: [14, 14],
            itemStyle: { borderWidth: 1, borderColor: 'var(--vscode-editorWidget-border, #454545)' },
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
