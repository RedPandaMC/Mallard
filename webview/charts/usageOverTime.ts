import type { ECharts } from 'echarts';
import { Granularity, Metric, UsageAggregate, UsageSnapshot } from '../../src/model/types';
import { formatMetric } from '../../src/model/format';
import { initChart } from './echarts';

export interface UsageOverTimeHandle {
  update(snapshot: UsageSnapshot, granularity: Granularity, metric: Metric): void;
  resize(): void;
  dispose(): void;
}

function pick(a: UsageAggregate, m: Metric): number {
  return m === 'cost' ? a.cost : m === 'credits' ? a.credits : a.tokens;
}

function formatX(key: string, gran: Granularity): string {
  // Shorten long keys for readability on the axis
  if (gran === 'hour' && key.length > 13) return key.slice(11, 16); // HH:MM
  if (gran === 'day' && key.length === 10) return key.slice(5); // MM-DD
  if (gran === 'week') return key.slice(5); // Wnn or MM-DD range
  return key;
}

export function mountUsageOverTime(el: HTMLElement): UsageOverTimeHandle {
  let chart: ECharts | null = null;

  function getChart(): ECharts {
    if (!chart) chart = initChart(el);
    return chart;
  }

  return {
    update(s: UsageSnapshot, granularity: Granularity, metric: Metric) {
      const c = getChart();
      const aggs: UsageAggregate[] = (s.aggregates as Record<string, UsageAggregate[]>)[granularity] ?? [];

      if (aggs.length === 0) {
        c.setOption({ series: [] }, true);
        return;
      }

      const keys = aggs.map((a) => formatX(a.bucketKey, granularity));
      const values = aggs.map((a) => pick(a, metric));

      c.setOption(
        {
          animation: true,
          grid: { top: 16, right: 16, bottom: 40, left: 16, containLabel: true },
          tooltip: {
            trigger: 'axis',
            formatter(params: any) {
              const p = Array.isArray(params) ? params[0] : params;
              if (!p) return '';
              return `<strong>${aggs[p.dataIndex]?.bucketKey ?? p.name}</strong><br/>${formatMetric(Number(p.value), metric, s.currency)}`;
            },
          },
          xAxis: {
            type: 'category',
            data: keys,
            boundaryGap: false,
            axisLabel: { rotate: keys.length > 24 ? 45 : 0 },
          },
          yAxis: {
            type: 'value',
            axisLabel: {
              formatter: (v: number) => formatMetric(v, metric, s.currency),
            },
          },
          series: [
            {
              type: 'line',
              data: values,
              smooth: 0.3,
              areaStyle: { opacity: 0.18 },
              lineStyle: { width: 2 },
              showSymbol: aggs.length <= 32,
              symbolSize: 5,
              emphasis: { focus: 'series' },
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
