/**
 * 30-day daily bar chart.
 *
 * - One bar per day, colored green/amber/red by % of daily included budget.
 * - Dashed line for the daily budget threshold (includedCredits / daysInMonth).
 * - Projected pace line when forecast data is available.
 */
import { echarts, initChart } from './echarts';
import { UsageAggregate, UsageSnapshot } from '../../src/model/types';
import { formatMoney, formatCredits } from '../../src/model/format';
import { DAY_MS, bucketKey, startOf } from '../../src/util/time';

export interface DailyBarsHandle {
  update(snapshot: UsageSnapshot): void;
  resize(): void;
}

function buildDays(snapshot: UsageSnapshot): Array<{ key: string; credits: number; cost: number }> {
  const now = Date.now();
  const days: Array<{ key: string; credits: number; cost: number }> = [];
  const byKey = new Map<string, UsageAggregate>(
    snapshot.aggregates.day.map((a) => [a.bucketKey, a]),
  );
  for (let i = 29; i >= 0; i--) {
    const ts = startOf(now - i * DAY_MS, 'day');
    const key = bucketKey(ts, 'day');
    const agg = byKey.get(key);
    days.push({ key, credits: agg?.credits ?? 0, cost: agg?.cost ?? 0 });
  }
  return days;
}

function barColor(credits: number, dailyBudget: number): string {
  if (dailyBudget <= 0) return 'inherit';
  const ratio = credits / dailyBudget;
  if (ratio >= 1.0) return 'var(--vscode-charts-red, #EF9A9A)';
  if (ratio >= 0.7) return 'var(--vscode-charts-orange, #FFB74D)';
  return 'var(--vscode-charts-blue, #4FC3F7)';
}

export function mountDailyBars(el: HTMLElement): DailyBarsHandle {
  const chart = initChart(el);

  return {
    update(s: UsageSnapshot) {
      const days = buildDays(s);
      const { includedCredits } = s.budget;
      const daysInMonth = 30;
      const dailyBudget = includedCredits > 0 ? includedCredits / daysInMonth : 0;

      const labels = days.map((d) => d.key.slice(5)); // MM-DD
      const values = days.map((d) => d.credits);
      const colors = days.map((d) => barColor(d.credits, dailyBudget));
      const currency = s.currency;

      const series: echarts.SeriesOption[] = [
        {
          type: 'bar',
          data: values.map((v, i) => ({ value: v, itemStyle: { color: colors[i] } })),
          name: 'Credits',
          emphasis: { itemStyle: { opacity: 0.85 } },
        },
      ];

      if (dailyBudget > 0) {
        series.push({
          type: 'line',
          data: days.map(() => dailyBudget),
          name: 'Daily budget',
          lineStyle: { type: 'dashed', color: 'var(--vscode-charts-orange, #FFB74D)', width: 1 },
          symbol: 'none',
          silent: true,
        } as echarts.SeriesOption);
      }

      if (s.forecast.basis !== 'insufficient-data') {
        const projectedDaily = s.forecast.projectedCredits / daysInMonth;
        series.push({
          type: 'line',
          data: days.map(() => projectedDaily),
          name: 'Projected pace',
          lineStyle: { type: 'dotted', color: 'var(--vscode-charts-purple, #CE93D8)', width: 1 },
          symbol: 'none',
          silent: true,
        } as echarts.SeriesOption);
      }

      chart.setOption(
        {
          animation: false,
          tooltip: {
            trigger: 'axis',
            formatter(params: echarts.TooltipComponentOption) {
              const p = (params as unknown as Array<{ name: string; value: number; seriesName: string }>)[0];
              if (!p) return '';
              const day = days[labels.indexOf(p.name)];
              if (!day) return '';
              return [
                `<strong>${day.key}</strong>`,
                `${formatCredits(day.credits)} cr`,
                formatMoney(day.cost, currency),
              ].join('<br/>');
            },
          },
          grid: { left: 40, right: 16, top: 12, bottom: 40, containLabel: false },
          xAxis: {
            type: 'category',
            data: labels,
            axisLabel: { rotate: 45, fontSize: 10, interval: 4 },
          },
          yAxis: { type: 'value', name: 'Credits', nameTextStyle: { fontSize: 10 } },
          series,
          legend: {
            show: series.length > 1,
            top: 0,
            right: 0,
            itemWidth: 14,
            itemHeight: 8,
            textStyle: { fontSize: 11 },
          },
        },
        true,
      );
    },

    resize() {
      chart.resize();
    },
  };
}
