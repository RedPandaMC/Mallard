import type { ECharts } from 'echarts';
import { Metric, UsageSnapshot } from '../../src/model/types';
import { formatMetric } from '../../src/model/format';
import { initChart } from './echarts';

export interface ModelBreakdownHandle {
  update(snapshot: UsageSnapshot, metric: Metric): void;
  resize(): void;
  dispose(): void;
}

export function mountModelBreakdown(el: HTMLElement): ModelBreakdownHandle {
  let chart: ECharts | null = null;

  function getChart(): ECharts {
    if (!chart) chart = initChart(el);
    return chart;
  }

  return {
    update(s: UsageSnapshot, metric: Metric) {
      const c = getChart();
      if (!s.topModels.length) {
        c.setOption({ series: [{ type: 'pie', data: [] }] }, true);
        return;
      }

      const data = s.topModels.slice(0, 8).map((m) => ({
        name: m.key,
        value: metric === 'cost' ? m.cost : metric === 'credits' ? m.credits : m.tokens,
      }));

      c.setOption(
        {
          animation: true,
          tooltip: {
            trigger: 'item',
            formatter(p: any) {
              return `${p.name}<br/>${formatMetric(p.value as number, metric, s.currency)} (${(p.percent as number).toFixed(1)}%)`;
            },
          },
          legend: {
            orient: 'vertical',
            right: 4,
            top: 'middle',
            type: 'scroll',
            textStyle: { fontSize: 11 },
            itemWidth: 10,
            itemHeight: 10,
          },
          series: [
            {
              type: 'pie',
              radius: ['38%', '68%'],
              center: ['38%', '50%'],
              avoidLabelOverlap: true,
              label: { show: false },
              emphasis: {
                label: { show: true, fontSize: 12, fontWeight: 'bold' },
                itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.4)' },
              },
              data,
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
