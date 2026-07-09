/**
 * Spend by repository — horizontal bars, top repos first. Repos whose spend is
 * (partly) attributed by the active-editor heuristic rather than recorded in
 * the source log are prefixed with "≈" so approximate rows are never mistaken
 * for authoritative ones.
 */
import type { TooltipComponentOption } from './echarts';
import { readTheme } from '../theme';
import { UsageSnapshot } from '../../extension-backend/domain/types';
import { formatCredits, formatMoney } from '../../extension-backend/domain/format';
import { ChartComponent } from './ChartComponent';

const TOP_N = 8;

export interface RepoBreakdownHandle {
  update(snapshot: UsageSnapshot): void;
  resize(): void;
  reinit(): void;
}

class RepoBreakdownChart extends ChartComponent {
  protected hasData(s: UsageSnapshot): boolean {
    return s.byRepo.some((r) => r.credits > 0 || r.cost > 0);
  }

  protected buildOption(s: UsageSnapshot): object {
    const t = readTheme();
    const top = s.byRepo.slice(0, TOP_N);
    // Reverse so the largest repo renders at the top of the category axis.
    const rows = [...top].reverse();
    const labels = rows.map((r) => ((r.heuristicShare ?? 0) > 0 ? `≈ ${r.key}` : r.key));
    const data = rows.map((r, i) => ({
      value: Math.round(r.credits * 100) / 100,
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
          const r = rows[p.dataIndex];
          if (!r) return '';
          const share = r.heuristicShare ?? 0;
          const approx = share > 0
            ? `<br/><i>≈ ${Math.round(share * 100)}% attributed heuristically</i>`
            : '';
          return `${r.key}<br/>${formatCredits(r.credits)} cr · ${formatMoney(r.cost, currency)}${approx}`;
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
        data: labels,
        axisTick: { show: false },
        axisLabel: { fontSize: 10, width: 120, overflow: 'truncate' },
      },
      series: [{ type: 'bar', data, barMaxWidth: 14 }],
    };
  }
}

export function mountRepoBreakdown(el: HTMLElement): RepoBreakdownHandle {
  return new RepoBreakdownChart(el);
}
