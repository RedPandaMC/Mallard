/**
 * Tokens over time — daily token volume as bars, with the request count in
 * the tooltip. One axis only: tokens and request counts live on different
 * scales, so events stay in the tooltip rather than on a second y-axis.
 */
import type { TooltipComponentOption } from './echarts';
import { readTheme } from '../theme';
import { UsageSnapshot } from '../../extension-backend/domain/types';
import { formatTokens } from '../../extension-backend/domain/format';
import { ChartComponent } from './ChartComponent';

export interface TokensTimelineHandle {
  update(snapshot: UsageSnapshot): void;
  resize(): void;
  reinit(): void;
}

class TokensTimelineChart extends ChartComponent {
  protected hasData(s: UsageSnapshot): boolean {
    return s.chartData.tokensDaily.tokens.some((v) => v > 0);
  }

  protected buildOption(s: UsageSnapshot): object {
    const t = readTheme();
    const { dates, tokens, events } = s.chartData.tokensDaily;
    const maxTokens = Math.max(...tokens);
    const data = tokens.map((v) => ({
      value: v,
      itemStyle: {
        color: v === maxTokens && v > 0 ? t.accent : (t.series[3] ?? t.muted),
        borderColor: t.border,
        borderWidth: t.highContrast ? 1 : 0,
      },
    }));
    return {
      animation: false,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter(params: TooltipComponentOption) {
          const p = (params as unknown as Array<{ dataIndex: number; axisValue: string }>)[0];
          if (!p) return '';
          const i = p.dataIndex;
          return `${p.axisValue}<br/>${formatTokens(tokens[i] ?? 0)} tokens · ${events[i] ?? 0} requests`;
        },
      },
      grid: { left: 44, right: 12, top: 8, bottom: 20 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { fontSize: 10, interval: 6 },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 10, formatter: (v: number) => formatTokens(v) },
        splitLine: { lineStyle: { color: t.border, opacity: 0.4 } },
      },
      series: [{ type: 'bar', data, barMaxWidth: 10 }],
    };
  }
}

export function mountTokensTimeline(el: HTMLElement): TokensTimelineHandle {
  return new TokensTimelineChart(el);
}
