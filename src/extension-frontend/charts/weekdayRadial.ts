/**
 * Usage by weekday — credits on a radial bar chart so weekly rhythm
 * (heavy weekdays, light weekends) reads at a glance.
 * weekdayBreakdown is pre-computed on the host (Sun=0 … Sat=6);
 * the chart displays Mon=0 … Sun=6 for readability.
 */
import type { TooltipComponentOption } from './echarts';
import { readTheme } from '../theme';
import { UsageSnapshot } from '../../extension-backend/domain/types';
import { formatCredits } from '../../extension-backend/domain/format';
import { ChartComponent } from './ChartComponent';

export interface WeekdayRadialHandle {
  update(snapshot: UsageSnapshot): void;
  resize(): void;
  reinit(): void;
}

// Display order: Mon=0 … Sun=6 (i.e. rotate stored Sun=0 array by one position right)
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

class WeekdayRadialChart extends ChartComponent {
  protected hasData(s: UsageSnapshot): boolean {
    return s.chartData.weekdayBreakdown.totals.some((v) => v > 0);
  }

  protected buildOption(s: UsageSnapshot): object {
    const { totals, peak } = s.chartData.weekdayBreakdown;
    const t = readTheme();

    // Rotate from Sun=0 storage to Mon=0 display: displayIdx → storedIdx = (displayIdx + 1) % 7
    const displayData = DAYS.map((_, displayIdx) => {
      const storedIdx = (displayIdx + 1) % 7;
      return Math.round(totals[storedIdx] ?? 0);
    });

    // Convert stored peak (Sun=0) to display index (Mon=0): displayPeak = (peak + 6) % 7
    const displayPeak = (peak + 6) % 7;

    const data = displayData.map((v, i) => ({
      value: v,
      itemStyle: {
        color: i === displayPeak ? t.accent : (t.series[3] ?? t.muted),
        borderColor: t.border,
        borderWidth: t.highContrast ? 1 : 0,
      },
    }));

    return {
      animation: false,
      tooltip: {
        trigger: 'item',
        formatter(p: TooltipComponentOption) {
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
    };
  }
}

export function mountWeekdayRadial(el: HTMLElement): WeekdayRadialHandle {
  return new WeekdayRadialChart(el);
}
