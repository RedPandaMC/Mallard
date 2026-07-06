/**
 * Pie chart — spend split by cost category (input / output / tool / thinking).
 * Consumes pre-computed CategoryBreakdownData from the host. When the data is
 * not available the caller hides the section; this chart only paints.
 */
import type { TooltipComponentOption } from './echarts';
import { readTheme } from '../theme';
import { UsageSnapshot } from '../../extension-backend/domain/types';
import { formatMoney } from '../../extension-backend/domain/format';
import { ChartComponent } from './ChartComponent';

const LABELS: Record<string, string> = {
  input: 'Input',
  output: 'Output',
  tool: 'Tool',
  thinking: 'Thinking',
  unknown: 'Other',
};

export interface CategoryBreakdownHandle {
  update(snapshot: UsageSnapshot): void;
  resize(): void;
  reinit(): void;
}

class CategoryBreakdownChart extends ChartComponent {
  protected notMerge = false;

  protected hasData(s: UsageSnapshot): boolean {
    const { available, categories } = s.chartData.categoryBreakdown;
    return available && categories.length > 0;
  }

  protected buildOption(s: UsageSnapshot): object {
    const { categories, costs } = s.chartData.categoryBreakdown;
    const currency = s.currency;
    const t = readTheme();
    void t; // theme applied via initChart theme registration
    const data = categories.map((c, i) => ({ name: LABELS[c] ?? c, value: costs[i] ?? 0 }));
    return {
      animation: false,
      tooltip: {
        trigger: 'item',
        formatter(p: TooltipComponentOption) {
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
    };
  }
}

export function mountCategoryBreakdown(el: HTMLElement): CategoryBreakdownHandle {
  return new CategoryBreakdownChart(el);
}
