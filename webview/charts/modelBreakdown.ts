/**
 * Horizontal bar chart — top models by credits/cost/tokens.
 * In cost mode a ghost bar shows what the same token count would have cost
 * using the cheapest available model, making the premium model premium visible.
 */
import { echarts, initChart } from './echarts';
import { Metric, UsageSnapshot } from '../../src/domain/types';
import { formatCredits, formatMoney, formatTokens } from '../../src/domain/format';

export interface ModelBreakdownHandle {
  update(snapshot: UsageSnapshot, metric: Metric): void;
  resize(): void;
}

export function mountModelBreakdown(el: HTMLElement): ModelBreakdownHandle {
  const chart = initChart(el);

  return {
    update(s: UsageSnapshot, metric: Metric) {
      const { labels, credits, costs, tokens, cheapestEquivalentCosts } =
        s.chartData.modelBreakdown;
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

      const showGhost = metric === 'cost';
      const reversedLabels = [...labels].reverse();
      const reversedValues = [...values].reverse();
      const reversedCheapest = [...cheapestEquivalentCosts].reverse();

      const series: echarts.EChartsOption['series'] = [
        {
          type: 'bar',
          data: reversedValues,
          label: {
            show: true,
            position: 'right',
            formatter: (p: { value: number }) => fmt(p.value),
            fontSize: 10,
          },
          z: 2,
        },
      ];

      if (showGhost) {
        series.push({
          type: 'bar',
          data: reversedCheapest,
          barGap: '-100%',
          itemStyle: { opacity: 0.18, color: 'currentColor', borderType: 'dashed', borderWidth: 1 },
          label: { show: false },
          tooltip: { show: false },
          z: 1,
        });
      }

      chart.setOption(
        {
          animation: false,
          tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'none' },
            formatter(params: echarts.TooltipComponentOption) {
              const items = params as unknown as Array<{ name: string; value: number; seriesIndex: number }>;
              const main = items.find((p) => p.seriesIndex === 0);
              if (!main) return '';
              if (!showGhost) return `${main.name}: ${fmt(main.value)}`;
              const cheapIdx = reversedLabels.indexOf(main.name);
              const cheapCost = cheapIdx >= 0 ? (reversedCheapest[cheapIdx] ?? 0) : 0;
              const saving = main.value - cheapCost;
              const cheapLine = `Cheapest equivalent: ${formatMoney(cheapCost, currency)}`;
              const saveLine = saving > 0.0001 ? `<br/>Save ${formatMoney(saving, currency)}` : '';
              return `${main.name}: ${fmt(main.value)}<br/>${cheapLine}${saveLine}`;
            },
          },
          grid: { left: 120, right: 48, top: 8, bottom: 8, containLabel: false },
          xAxis: { type: 'value', axisLabel: { formatter: (v: number) => fmt(v), fontSize: 10 } },
          yAxis: {
            type: 'category',
            data: reversedLabels,
            axisLabel: { fontSize: 11 },
          },
          series,
        },
        { notMerge: false, lazyUpdate: true },
      );
    },

    resize() {
      chart.resize();
    },
  };
}
