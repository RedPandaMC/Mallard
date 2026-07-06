/**
 * Model → surface Sankey chart.
 *
 * Rendered whenever there's at least one flow link — a single model/surface
 * still produces a valid (if simple) flow diagram. Lazy init is handled by
 * lazyChart() in main.ts — no internal IntersectionObserver needed here.
 */
import type { TooltipComponentOption } from './echarts';
import { UsageSnapshot } from '../../extension-backend/domain/types';
import { formatCredits } from '../../extension-backend/domain/format';
import { ChartComponent } from './ChartComponent';

export interface SankeyHandle {
  update(snapshot: UsageSnapshot): void;
  resize(): void;
  reinit(): void;
}

function shortName(id: string): string {
  return id
    .replace(/^(models\/|openai\/|anthropic\/|google\/)/, '')
    .slice(0, 26);
}

class SankeyChart extends ChartComponent {
  protected notMerge = false;

  protected hasData(s: UsageSnapshot): boolean {
    return s.sankeyLinks.length > 0;
  }

  protected onHide(): void { this.el.style.display = 'none'; }
  protected onShow(): void { this.el.style.display = ''; }

  protected buildOption(s: UsageSnapshot): object {
    const { sankeyLinks } = s;
    const nodeNames = new Set<string>();
    for (const l of sankeyLinks) {
      nodeNames.add(l.source);
      nodeNames.add(l.target);
    }
    const nodes = [...nodeNames].map((name) => ({
      name,
      label: { formatter: () => shortName(name) },
    }));
    const links = sankeyLinks.map((l) => ({ source: l.source, target: l.target, value: l.value }));
    return {
      animation: false,
      tooltip: {
        trigger: 'item',
        formatter(params: TooltipComponentOption) {
          const p = params as unknown as {
            dataType: string;
            name: string;
            value: number;
            data: { source?: string; target?: string; value?: number };
          };
          if (p.dataType === 'edge') {
            return `${shortName(p.data.source ?? '')} → ${p.data.target}<br/>${formatCredits(p.data.value ?? 0)} cr`;
          }
          return `${shortName(p.name)}<br/>${formatCredits(p.value)} cr`;
        },
      },
      series: [
        {
          type: 'sankey',
          data: nodes,
          links,
          orient: 'horizontal',
          label: { fontSize: 11 },
          lineStyle: { curveness: 0.5, opacity: 0.5 },
          itemStyle: { borderWidth: 0 },
          emphasis: { focus: 'adjacency', lineStyle: { opacity: 0.8 } },
        },
      ],
    };
  }
}

export function mountSankey(el: HTMLElement): SankeyHandle {
  return new SankeyChart(el);
}
