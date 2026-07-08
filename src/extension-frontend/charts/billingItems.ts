/**
 * GitHub billing line items — net amount per model/SKU straight from the
 * billing API. Only populated when signed in; the panel shows its empty state
 * otherwise (the header sign-in button is the call to action).
 */
import type { TooltipComponentOption } from './echarts';
import { readTheme } from '../theme';
import { GitHubBillingItem, UsageSnapshot } from '../../extension-backend/domain/types';
import { formatMoney } from '../../extension-backend/domain/format';
import { ChartComponent } from './ChartComponent';

const TOP_N = 8;

function itemLabel(it: GitHubBillingItem): string {
  return it.model || it.sku || 'unknown';
}

export interface BillingItemsHandle {
  update(snapshot: UsageSnapshot): void;
  resize(): void;
  reinit(): void;
}

class BillingItemsChart extends ChartComponent {
  protected hasData(s: UsageSnapshot): boolean {
    return (s.githubBilling?.items ?? []).some((it) => it.netAmount > 0 || it.grossAmount > 0);
  }

  protected buildOption(s: UsageSnapshot): object {
    const t = readTheme();
    const items = [...(s.githubBilling?.items ?? [])]
      .sort((a, b) => b.netAmount - a.netAmount)
      .slice(0, TOP_N)
      .reverse(); // largest at the top of the category axis
    const data = items.map((it, i) => ({
      value: Math.round(it.netAmount * 100) / 100,
      itemStyle: {
        color: i === items.length - 1 ? t.accent : (t.series[3] ?? t.muted),
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
          const p = (params as unknown as Array<{ dataIndex: number }>)[0];
          if (!p) return '';
          const it = items[p.dataIndex];
          if (!it) return '';
          // Billing amounts are USD from the GitHub API, not display currency.
          const discount = it.grossAmount - it.netAmount;
          const detail = discount > 0.005
            ? `net ${formatMoney(it.netAmount)} · gross ${formatMoney(it.grossAmount)}`
            : formatMoney(it.netAmount);
          return `${itemLabel(it)}<br/>${detail}`;
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
        data: items.map(itemLabel),
        axisTick: { show: false },
        axisLabel: { fontSize: 10, width: 120, overflow: 'truncate' },
      },
      series: [{ type: 'bar', data, barMaxWidth: 14 }],
    };
  }
}

export function mountBillingItems(el: HTMLElement): BillingItemsHandle {
  return new BillingItemsChart(el);
}
