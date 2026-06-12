import type { ECharts } from 'echarts';
import { Metric, UsageSnapshot } from '../../src/model/types';
import { formatMetric } from '../../src/model/format';
import { initChart } from './echarts';

export interface RepoBreakdownHandle {
  update(snapshot: UsageSnapshot, metric: Metric): void;
  resize(): void;
  dispose(): void;
}

export function mountRepoBreakdown(el: HTMLElement): RepoBreakdownHandle {
  let chart: ECharts | null = null;

  function getChart(): ECharts {
    if (!chart) chart = initChart(el);
    return chart;
  }

  return {
    update(s: UsageSnapshot, metric: Metric) {
      const c = getChart();
      if (!s.topRepos.length) {
        c.setOption({ series: [{ type: 'bar', data: [] }] }, true);
        return;
      }

      const items = s.topRepos.slice(0, 10).reverse(); // reverse so largest is at top
      const names = items.map((r) => r.key);
      const values = items.map((r) =>
        metric === 'cost' ? r.cost : metric === 'credits' ? r.credits : r.tokens,
      );

      c.setOption(
        {
          animation: true,
          grid: { top: 8, right: 24, bottom: 8, left: 8, containLabel: true },
          tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter(params: any) {
              const p = Array.isArray(params) ? params[0] : params;
              if (!p) return '';
              return `${p.name}<br/>${formatMetric(Number(p.value), metric, s.currency)}`;
            },
          },
          xAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatMetric(v, metric, s.currency) } },
          yAxis: {
            type: 'category',
            data: names,
            axisLabel: {
              fontSize: 11,
              formatter: (v: string) => (v.length > 20 ? v.slice(0, 18) + '…' : v),
            },
          },
          series: [
            {
              type: 'bar',
              data: values,
              barMaxWidth: 24,
              emphasis: { focus: 'self' },
              itemStyle: { borderRadius: [0, 3, 3, 0] },
            },
          ],
        },
        true,
      );
    },

    resize() {
      chart?.resize();
    },

    dispose() {
      chart?.dispose();
      chart = null;
    },
  };
}
