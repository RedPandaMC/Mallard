/**
 * Pie chart — spend split by cost category (input / output / tool / thinking).
 * Consumes pre-computed CategoryBreakdownData from the host. When the data is
 * not available the caller hides the section; this chart only paints.
 */
import { echarts, initChart } from './echarts';
import { UsageSnapshot } from '../../src/domain/types';
import { formatMoney } from '../../src/domain/format';

export interface CategoryBreakdownHandle {
  update(snapshot: UsageSnapshot): void;
  resize(): void;
}

const LABELS: Record<string, string> = {
  input: 'Input',
  output: 'Output',
  tool: 'Tool',
  thinking: 'Thinking',
  unknown: 'Other',
};

export function mountCategoryBreakdown(el: HTMLElement): CategoryBreakdownHandle {
  const chart = initChart(el);

  return {
    update(s: UsageSnapshot) {
      const { categories, costs, available } = s.chartData.categoryBreakdown;
      if (!available || categories.length === 0) {
        chart.clear();
        return;
      }
      const currency = s.currency;
      const data = categories.map((c, i) => ({ name: LABELS[c] ?? c, value: costs[i] ?? 0 }));

      chart.setOption(
        {
          animation: false,
          tooltip: {
            trigger: 'item',
            formatter(p: echarts.TooltipComponentOption) {
              const item = p as unknown as { name: string; value: number; percent: number };
              return `${item.name}: ${formatMoney(item.value, currency)} (${item.percent}%)`;
            },
          },
          legend: { bottom: 0, textStyle: { fontSize: 11 } },
          series: [
            {
              type: 'pie',
              radius: ['40%', '68%'],
              center: ['50%', '44%'],
              avoidLabelOverlap: true,
              label: { show: false },
              data,
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
