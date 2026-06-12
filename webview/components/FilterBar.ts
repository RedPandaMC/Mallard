import { Metric, UsageSnapshot } from '../../src/model/types';
import { post } from '../api';
import { setState } from '../store';

export interface FilterBarHandle {
  update(snapshot: UsageSnapshot, metric: Metric): void;
}

const METRICS: { value: Metric; label: string }[] = [
  { value: 'cost', label: '$' },
  { value: 'credits', label: 'cr' },
  { value: 'tokens', label: 'tok' },
];

export function mountFilterBar(el: HTMLElement): FilterBarHandle {
  el.className = 'wv-filter-bar';
  el.innerHTML = `
    <span class="wv-filter-label">Metric</span>
    <div class="wv-metric-toggle" role="group" aria-label="Select metric">
      ${METRICS.map((m) => `<button class="wv-metric-btn" data-metric="${m.value}" aria-pressed="false">${m.label}</button>`).join('')}
    </div>
    <div id="wv-repo-group" style="display:none;align-items:center;gap:8px;margin-left:auto">
      <span class="wv-filter-label">Repos</span>
      <select class="wv-filter-select" id="filter-repo" aria-label="Filter by repository">
        <option value="">All repos</option>
      </select>
    </div>`;

  const metricBtns = el.querySelectorAll<HTMLButtonElement>('.wv-metric-btn');
  const repoGroup = el.querySelector<HTMLElement>('#wv-repo-group')!;
  const repoSelect = el.querySelector<HTMLSelectElement>('#filter-repo')!;

  for (const btn of metricBtns) {
    btn.addEventListener('click', () => {
      const m = btn.dataset.metric as Metric;
      setState({ metric: m });
      post({ type: 'setMetric', value: m });
    });
  }

  repoSelect.addEventListener('change', () => {
    const repo = repoSelect.value;
    const filter = repo ? { repos: [repo] } : {};
    setState({ filter });
    post({ type: 'setFilter', value: filter });
  });

  return {
    update(s: UsageSnapshot, metric: Metric) {
      for (const btn of metricBtns) {
        btn.setAttribute('aria-pressed', String(btn.dataset.metric === metric));
      }

      if (s.topRepos.length > 1) {
        repoGroup.style.display = 'flex';
        const current = repoSelect.value;
        while (repoSelect.options.length > 1) repoSelect.remove(1);
        for (const r of s.topRepos) {
          const opt = document.createElement('option');
          opt.value = r.key;
          opt.textContent = r.key;
          if (r.key === current) opt.selected = true;
          repoSelect.appendChild(opt);
        }
      } else {
        repoGroup.style.display = 'none';
      }
    },
  };
}
