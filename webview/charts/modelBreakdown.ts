/**
 * Horizontal bar chart — top models by credits/cost/tokens.
 * Consumes pre-computed ModelBreakdownData from the host.
 */
import { echarts, initChart } from './echarts';
import { Metric, UsageSnapshot } from '../../src/model/types';
import { formatCredits, formatMoney, formatTokens } from '../../src/model/format';

export interface ModelBreakdownHandle {
  update(snapshot: UsageSnapshot, metric: Metric): void;
  resize(): void;
}

export function mountModelBreakdown(el: HTMLElement): ModelBreakdownHandle {
  const chart = initChart(el);

  return {
    update(s: UsageSnapshot, metric: Metric) {
      const { labels, credits, costs, tokens } = s.chartData.modelBreakdown;
      if (labels.length === 0) {
        chart.clear();
        return;
      }

      const values = metric === 'cost' ? costs : metric === 'tokens' ? tokens : credits;
      const currency = s.currency;

      function fmt(v: number) {
        if (metric === 'cost') return formatMoney(v, currency);
        if (metric === 'credits') return `${formatCredits(v)} cr`;
        return `${formatTokens(v)} tok`;
      }

      chart.setOption(
        {
          animation: false,
          tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'none' },
            formatter(params: echarts.TooltipComponentOption) {
              const p = (params as unknown as Array<{ name: string; value: number }>)[0];
              return p ? `${p.name}: ${fmt(p.value)}` : '';
            },
          },
          grid: { left: 120, right: 48, top: 8, bottom: 8, containLabel: false },
          xAxis: { type: 'value', axisLabel: { formatter: (v: number) => fmt(v), fontSize: 10 } },
          yAxis: {
            type: 'category',
            data: [...labels].reverse(),
            axisLabel: { fontSize: 11 },
          },
          series: [
            {
              type: 'bar',
              data: [...values].reverse(),
              label: {
                show: true,
                position: 'right',
                formatter: (p: { value: number }) => fmt(p.value),
                fontSize: 10,
              },
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
