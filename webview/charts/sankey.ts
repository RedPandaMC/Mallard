/**
 * Model → surface Sankey chart.
 *
 * Only rendered when ≥2 models and ≥2 surfaces are present in the current
 * filtered data. Shows how credits flow from models into usage surfaces.
 */
import { echarts, initChart } from './echarts';
import { UsageSnapshot } from '../../src/model/types';
import { formatCredits } from '../../src/model/format';

export interface SankeyHandle {
  update(snapshot: UsageSnapshot): void;
  resize(): void;
}

function shortName(id: string): string {
  return id
    .replace(/^(models\/|openai\/|anthropic\/|google\/)/, '')
    .replace('claude-', 'claude-')
    .replace('gpt-', 'gpt-')
    .slice(0, 26);
}

export function mountSankey(el: HTMLElement): SankeyHandle {
  const chart = initChart(el);

  return {
    update(s: UsageSnapshot) {
      const { sankeyLinks, allModels, allSurfaces } = s;

      // Only show when there's meaningful multi-dimensional data.
      if (allModels.length < 2 || allSurfaces.length < 2 || sankeyLinks.length === 0) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';

      const nodeNames = new Set<string>();
      for (const l of sankeyLinks) {
        nodeNames.add(l.source);
        nodeNames.add(l.target);
      }

      const nodes = [...nodeNames].map((name) => ({
        name,
        label: { formatter: () => shortName(name) },
      }));

      const links = sankeyLinks.map((l) => ({
        source: l.source,
        target: l.target,
        value: l.value,
      }));

      chart.setOption(
        {
          animation: false,
          tooltip: {
            trigger: 'item',
            formatter(params: echarts.TooltipComponentOption) {
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
              emphasis: {
                focus: 'adjacency',
                lineStyle: { opacity: 0.8 },
              },
            },
          ],
        },
        true,
      );
    },

    resize() {
      chart.resize();
    },
  };
}
