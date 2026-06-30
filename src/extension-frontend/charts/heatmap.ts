/**
 * Calendar heatmap — configurable weeks of daily credit usage.
 * Consumes pre-computed HeatmapData from the host.
 * Only rendered when there is at least one non-zero day.
 */
import type { TooltipComponentOption } from './echarts';
import { readTheme } from '../theme';
import { UsageSnapshot } from '../../extension-backend/domain/types';
import { formatCredits } from '../../extension-backend/domain/format';
import { ChartComponent } from './ChartComponent';

export interface HeatmapHandle {
  update(snapshot: UsageSnapshot): void;
  resize(): void;
}

class HeatmapChart extends ChartComponent {
  protected notMerge = false;

  protected hasData(s: UsageSnapshot): boolean {
    return s.chartData.heatmap.max > 0;
  }

  protected onHide(): void { this.el.style.display = 'none'; }
  protected onShow(): void { this.el.style.display = ''; }

  protected buildOption(s: UsageSnapshot): object {
    const { cells, max } = s.chartData.heatmap;
    const t = readTheme();
    const rangeStart = cells[0]?.date ?? '';
    const rangeEnd   = cells[cells.length - 1]?.date ?? '';
    return {
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
    };
  }
}

export function mountHeatmap(el: HTMLElement): HeatmapHandle {
  return new HeatmapChart(el);
}
