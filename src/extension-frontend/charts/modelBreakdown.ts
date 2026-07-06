/**
 * Horizontal bar chart — top models by credits/cost/tokens.
 * In cost mode a ghost bar shows what the same token count would have cost
 * using the cheapest available model, making the premium model premium visible.
 */
import type { TooltipComponentOption } from './echarts';
import { Metric, UsageSnapshot } from '../../extension-backend/domain/types';
import { formatCredits, formatMoney, formatTokens } from '../../extension-backend/domain/format';
import { ChartComponent } from './ChartComponent';
import { readTheme } from '../theme';

export interface ModelBreakdownHandle {
  update(snapshot: UsageSnapshot, metric?: Metric): void;
  resize(): void;
  reinit(): void;
  setFocused(models: ReadonlySet<string>): void;
}

class ModelBreakdownChart extends ChartComponent {
  protected notMerge = false;
  private metric: Metric = 'credits';
  private focusedModels: ReadonlySet<string> = new Set();

  protected hasData(s: UsageSnapshot): boolean {
    return s.chartData.modelBreakdown.labels.length > 0;
  }

  override update(s: UsageSnapshot, metric?: Metric): void {
    if (metric !== undefined) this.metric = metric;
    super.update(s);
  }

  setFocused(models: ReadonlySet<string>): void {
    this.focusedModels = models;
  }

  onMount(onModelClick: (label: string) => void): void {
    this.chart.on('click', (params: unknown) => {
      const p = params as { name?: string };
      if (p.name) onModelClick(p.name);
    });
  }

  protected override buildOption(s: UsageSnapshot): object {
    const { labels, credits, costs, tokens, cheapestEquivalentCosts } = s.chartData.modelBreakdown;
    const metric = this.metric;
    const currency = s.currency;
    const focused = this.focusedModels;

    const values = metric === 'cost' ? costs : metric === 'tokens' ? tokens : credits;

    function fmt(v: number) {
      if (metric === 'cost') return formatMoney(v, currency);
      if (metric === 'credits') return `${formatCredits(v)} cr`;
      return `${formatTokens(v)} tok`;
    }

    const showGhost = metric === 'cost';
    const dimmedFg = readTheme().muted;
    const reversedLabels = [...labels].reverse();
    const reversedValues = [...values].reverse();
    const reversedCheapest = [...cheapestEquivalentCosts].reverse();

    const mainSeries = {
      type: 'bar' as const,
      data: reversedValues.map((v, i) => ({
        value: v,
        itemStyle: focused.size > 0 && !focused.has(reversedLabels[i] ?? '')
          ? { opacity: 0.25 }
          : undefined,
      })),
      label: {
        show: true,
        position: 'right' as const,
        formatter: (p: { value?: unknown }) => fmt((p.value ?? 0) as number),
        fontSize: 10,
      },
      z: 2,
    };

    const ghostSeries = showGhost
      ? [{
          type: 'bar' as const,
          data: reversedCheapest,
          barGap: '-100%',
          itemStyle: { opacity: 0.18, color: 'currentColor', borderType: 'dashed' as const, borderWidth: 1 },
          label: { show: false },
          tooltip: { show: false },
          z: 1,
        }]
      : [];

    return {
      animation: false,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'none' },
        formatter(params: TooltipComponentOption) {
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
        axisLabel: {
          fontSize: 11,
          color: (value: string) =>
            focused.size > 0 && !focused.has(value) ? dimmedFg : undefined,
        },
      },
      series: [mainSeries, ...ghostSeries],
    };
  }
}

export function mountModelBreakdown(
  el: HTMLElement,
  onModelClick?: (label: string) => void,
): ModelBreakdownHandle {
  const chart = new ModelBreakdownChart(el);
  if (onModelClick) chart.onMount(onModelClick);
  return chart;
}
