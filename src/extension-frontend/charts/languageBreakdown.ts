/**
 * Spend by programming language — horizontal bars, top languages first.
 * Language is detected the same way the repo fallback is: the active editor's
 * languageId at parse time, applied to live events only. The panel title
 * carries "≈" and the tooltip says so, because the whole dimension is
 * directional rather than authoritative.
 */
import type { TooltipComponentOption } from './echarts';
import { readTheme } from '../theme';
import { UsageSnapshot } from '../../extension-backend/domain/types';
import { formatCredits, formatMoney } from '../../extension-backend/domain/format';
import { ChartComponent } from './ChartComponent';

const TOP_N = 8;

export interface LanguageBreakdownHandle {
  update(snapshot: UsageSnapshot): void;
  resize(): void;
  reinit(): void;
}

class LanguageBreakdownChart extends ChartComponent {
  protected hasData(s: UsageSnapshot): boolean {
    return s.byLanguage.some((l) => l.key !== 'unknown' && (l.credits > 0 || l.cost > 0));
  }

  protected buildOption(s: UsageSnapshot): object {
    const t = readTheme();
    const top = s.byLanguage.filter((l) => l.key !== 'unknown').slice(0, TOP_N);
    // Reverse so the largest language renders at the top of the category axis.
    const rows = [...top].reverse();
    const data = rows.map((l, i) => ({
      value: Math.round(l.credits * 100) / 100,
      itemStyle: {
        color: i === rows.length - 1 ? t.accent : (t.series[3] ?? t.muted),
        borderColor: t.border,
        borderWidth: t.highContrast ? 1 : 0,
      },
    }));
    const currency = s.currency || 'USD';
    return {
      animation: false,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter(params: TooltipComponentOption) {
          const p = (params as unknown as Array<{ dataIndex: number }>)[0];
          if (!p) return '';
          const l = rows[p.dataIndex];
          if (!l) return '';
          return `${l.key}<br/>${formatCredits(l.credits)} cr · ${formatMoney(l.cost, currency)}` +
            `<br/><i>≈ detected from the active editor</i>`;
        },
      },
      grid: { left: 8, right: 16, top: 8, bottom: 20, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { fontSize: 10 },
        splitLine: { lineStyle: { color: t.border, opacity: 0.4 } },
      },
      yAxis: {
        type: 'category',
        data: rows.map((l) => l.key),
        axisTick: { show: false },
        axisLabel: { fontSize: 10, width: 120, overflow: 'truncate' },
      },
      series: [{ type: 'bar', data, barMaxWidth: 14 }],
    };
  }
}

export function mountLanguageBreakdown(el: HTMLElement): LanguageBreakdownHandle {
  return new LanguageBreakdownChart(el);
}
