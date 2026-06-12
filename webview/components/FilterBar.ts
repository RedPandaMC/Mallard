/**
 * Filter bar with:
 *   1. Date-range preset buttons (Today | 7d | 30d | This month | All time)
 *   2. Metric toggle (Cost | Credits | Tokens)
 *   3. Model multi-select dropdown (populated from snapshot data)
 *   4. Surface chips (only when >1 surface present)
 */
import { post } from '../api';
import { setState, state } from '../store';
import { DatePreset, Filter, Metric, Surface, UsageSnapshot } from '../../src/model/types';
import { DAY_MS, nextBucketStart, startOf } from '../../src/util/time';

export interface FilterBarHandle {
  update(snapshot: UsageSnapshot, metric: Metric): void;
}

const DATE_PRESETS: Array<{ id: DatePreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
];

const METRICS: Array<{ id: Metric; label: string }> = [
  { id: 'cost', label: 'Cost' },
  { id: 'credits', label: 'Credits' },
  { id: 'tokens', label: 'Tokens' },
];

function presetToRange(preset: DatePreset, now: number): { start: number; end: number } | undefined {
  switch (preset) {
    case 'today': {
      const s = startOf(now, 'day');
      return { start: s, end: nextBucketStart(now, 'day') };
    }
    case '7d':
      return { start: now - 7 * DAY_MS, end: now + 1 };
    case '30d':
      return { start: now - 30 * DAY_MS, end: now + 1 };
    case 'month': {
      const s = startOf(now, 'month');
      return { start: s, end: nextBucketStart(now, 'month') };
    }
    case 'all':
      return undefined;
  }
}

function buildFilter(
  preset: DatePreset,
  models: string[],
  surface: Surface | null,
): Filter {
  const now = Date.now();
  const range = presetToRange(preset, now);
  return {
    ...(range !== undefined ? { range } : {}),
    ...(models.length ? { models } : {}),
    ...(surface ? { surfaces: [surface] } : {}),
  } as Filter;
}

export function mountFilterBar(el: HTMLElement): FilterBarHandle {
  el.innerHTML = `
    <div class="wv-filter-bar">
      <div class="wv-date-presets" role="group" aria-label="Date range">
        ${DATE_PRESETS.map((p) => `
          <button class="wv-preset-btn" data-preset="${p.id}" aria-pressed="false">${p.label}</button>
        `).join('')}
      </div>
      <div class="wv-filter-spacer"></div>
      <div class="wv-model-filter" id="model-filter" style="display:none">
        <button class="wv-filter-btn" id="model-filter-btn" aria-haspopup="listbox" aria-expanded="false">
          <i class="codicon codicon-symbol-method"></i>
          <span id="model-filter-label">All models</span>
          <i class="codicon codicon-chevron-down"></i>
        </button>
        <div class="wv-model-dropdown" id="model-dropdown" role="listbox" aria-multiselectable="true" hidden></div>
      </div>
      <div class="wv-metric-toggle" role="group" aria-label="Metric">
        ${METRICS.map((m) => `
          <button class="wv-metric-btn" data-metric="${m.id}" aria-pressed="false">${m.label}</button>
        `).join('')}
      </div>
    </div>
    <div class="wv-surface-chips" id="surface-chips" style="display:none" role="group" aria-label="Surface"></div>`;

  let activePreset: DatePreset = state.datePreset;
  let activeModels: string[] = [];
  let activeSurface: Surface | null = null;

  function updatePresetUI() {
    el.querySelectorAll<HTMLElement>('[data-preset]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.preset === activePreset));
    });
  }

  function updateMetricUI(metric: Metric) {
    el.querySelectorAll<HTMLElement>('[data-metric]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.metric === metric));
    });
  }

  function dispatchFilter() {
    const filter = buildFilter(activePreset, activeModels, activeSurface);
    setState({ filter, datePreset: activePreset });
    post({ type: 'setFilter', value: filter });
  }

  el.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activePreset = btn.dataset.preset as DatePreset;
      updatePresetUI();
      dispatchFilter();
    });
  });

  el.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setState({ metric: btn.dataset.metric as Metric });
    });
  });

  const modelFilterEl = el.querySelector<HTMLElement>('#model-filter')!;
  const modelFilterBtn = el.querySelector<HTMLButtonElement>('#model-filter-btn')!;
  const modelDropdown = el.querySelector<HTMLElement>('#model-dropdown')!;
  const modelLabel = el.querySelector<HTMLElement>('#model-filter-label')!;

  modelFilterBtn.addEventListener('click', () => {
    const nowHidden = modelDropdown.hidden;
    modelDropdown.hidden = !nowHidden;
    modelFilterBtn.setAttribute('aria-expanded', String(nowHidden));
  });

  document.addEventListener('click', (e) => {
    if (!modelFilterEl.contains(e.target as Node)) {
      modelDropdown.hidden = true;
      modelFilterBtn.setAttribute('aria-expanded', 'false');
    }
  });

  function updateModelLabel() {
    if (activeModels.length === 0) {
      modelLabel.textContent = 'All models';
    } else if (activeModels.length === 1) {
      modelLabel.textContent = activeModels[0]!.slice(0, 24);
    } else {
      modelLabel.textContent = `${activeModels.length} models`;
    }
  }

  function rebuildModelDropdown(allModels: string[]) {
    modelDropdown.innerHTML = '';

    const allOpt = document.createElement('div');
    allOpt.className = 'wv-model-option';
    allOpt.setAttribute('role', 'option');
    allOpt.dataset.model = '__all__';
    const allIcon = document.createElement('i');
    allIcon.className = `codicon codicon-${activeModels.length === 0 ? 'check' : 'blank'}`;
    allOpt.appendChild(allIcon);
    allOpt.append(' All models');
    allOpt.addEventListener('click', () => {
      activeModels = [];
      updateModelLabel();
      rebuildModelDropdown(allModels);
      dispatchFilter();
    });
    modelDropdown.appendChild(allOpt);

    for (const m of allModels) {
      const opt = document.createElement('div');
      opt.className = 'wv-model-option';
      opt.setAttribute('role', 'option');
      opt.dataset.model = m;
      const icon = document.createElement('i');
      icon.className = `codicon codicon-${activeModels.includes(m) ? 'check' : 'blank'}`;
      opt.appendChild(icon);
      opt.append(` ${m.replace(/^(models\/|gpt-|claude-|gemini-)/, '').slice(0, 30)}`);
      opt.addEventListener('click', () => {
        if (activeModels.includes(m)) {
          activeModels = activeModels.filter((x) => x !== m);
        } else {
          activeModels = [...activeModels, m];
        }
        updateModelLabel();
        rebuildModelDropdown(allModels);
        dispatchFilter();
      });
      modelDropdown.appendChild(opt);
    }
  }

  const surfaceChips = el.querySelector<HTMLElement>('#surface-chips')!;

  function updateSurfaceUI() {
    surfaceChips.querySelectorAll<HTMLElement>('[data-surface]').forEach((c) => {
      const sv = c.dataset.surface;
      c.setAttribute(
        'aria-pressed',
        String(sv === '__all__' ? activeSurface === null : activeSurface === sv),
      );
    });
  }

  updatePresetUI();

  return {
    update(s: UsageSnapshot, metric: Metric) {
      updateMetricUI(metric);

      if (s.allModels.length > 1) {
        modelFilterEl.style.display = '';
        rebuildModelDropdown(s.allModels);
      } else {
        modelFilterEl.style.display = 'none';
        activeModels = [];
      }

      if (s.allSurfaces.length > 1) {
        surfaceChips.style.display = '';
        surfaceChips.innerHTML = '';

        const allChip = document.createElement('button');
        allChip.className = 'wv-surface-chip';
        allChip.dataset.surface = '__all__';
        allChip.setAttribute('aria-pressed', String(activeSurface === null));
        allChip.textContent = 'All';
        allChip.addEventListener('click', () => {
          activeSurface = null;
          updateSurfaceUI();
          dispatchFilter();
        });
        surfaceChips.appendChild(allChip);

        for (const surf of s.allSurfaces) {
          const chip = document.createElement('button');
          chip.className = 'wv-surface-chip';
          chip.dataset.surface = surf;
          chip.setAttribute('aria-pressed', String(activeSurface === surf));
          chip.textContent = surf;
          chip.addEventListener('click', () => {
            activeSurface = activeSurface === surf ? null : surf;
            updateSurfaceUI();
            dispatchFilter();
          });
          surfaceChips.appendChild(chip);
        }
      } else {
        surfaceChips.style.display = 'none';
        activeSurface = null;
      }
    },
  };
}
