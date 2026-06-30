/**
 * Filter bar with:
 *   1. Date-range preset buttons (Today | 7d | 30d | This month | All time)
 *   2. Metric toggle (Cost | Credits | Tokens)
 *   3. Model multi-select dropdown (populated from snapshot data)
 *   4. Surface chips (only when >1 surface present)
 */
import { post } from '../api';
import { setState, state } from '../store';
import { DatePreset, Filter, Metric, SourceKind, Surface, UsageSnapshot } from '../../extension-backend/domain/types';
import { DAY_MS, nextBucketStart, startOf } from '../../extension-backend/util/time';

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
    default: {
      const _exhaustive: never = preset;
      throw new Error(`Unknown preset: ${String(_exhaustive)}`);
    }
  }
}

/** Copilot-type sources (LM calls, local OTel logs, GitHub billing). */
const COPILOT_SOURCES: SourceKind[] = ['lm', 'local', 'github'];

function buildFilter(
  preset: DatePreset,
  models: string[],
  surface: Surface | null,
  repos: string[],
  sources: SourceKind[],
): Filter {
  const now = Date.now();
  const range = presetToRange(preset, now);
  return {
    ...(range !== undefined ? { range } : {}),
    ...(models.length ? { models } : {}),
    ...(surface ? { surfaces: [surface] } : {}),
    ...(repos.length ? { repos } : {}),
    ...(sources.length ? { sources } : {}),
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
      <select class="wv-repo-select" id="repo-select" aria-label="Repository" hidden></select>
      <div class="wv-model-filter" id="model-filter" hidden>
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
    <div class="wv-surface-chips" id="surface-chips" hidden role="group" aria-label="Surface"></div>
    <div class="wv-source-chips" id="source-chips" hidden role="group" aria-label="Source"></div>`;

  let activePreset: DatePreset = state().datePreset;
  let activeModels: string[] = [];
  let activeSurface: Surface | null = null;
  let activeRepos: string[] = [];
  let activeSources: SourceKind[] = [];

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
    const filter = buildFilter(activePreset, activeModels, activeSurface, activeRepos, activeSources);
    setState({ filter, datePreset: activePreset });
    post({ type: 'setFilter', value: filter });
  }

  const repoSelect = el.querySelector<HTMLSelectElement>('#repo-select')!;
  repoSelect.addEventListener('change', () => {
    activeRepos = repoSelect.value === '__all__' ? [] : [repoSelect.value];
    dispatchFilter();
  });

  function rebuildRepoSelect(allRepos: string[]) {
    const selected = activeRepos[0] ?? '__all__';
    repoSelect.innerHTML = '';
    for (const r of ['__all__', ...allRepos]) {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r === '__all__' ? 'All repos' : r;
      opt.selected = r === selected;
      repoSelect.appendChild(opt);
    }
  }

  el.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      if (!DATE_PRESETS.some((p) => p.id === preset)) return;
      activePreset = preset as DatePreset;
      updatePresetUI();
      dispatchFilter();
    });
  });

  el.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const metric = btn.dataset.metric;
      if (!METRICS.some((m) => m.id === metric)) return;
      setState({ metric: metric as Metric });
    });
  });

  const modelFilterEl = el.querySelector<HTMLElement>('#model-filter')!;
  const modelFilterBtn = el.querySelector<HTMLButtonElement>('#model-filter-btn')!;
  const modelDropdown = el.querySelector<HTMLElement>('#model-dropdown')!;
  const modelLabel = el.querySelector<HTMLElement>('#model-filter-label')!;

  function openDropdown(): void {
    modelDropdown.hidden = false;
    modelFilterBtn.setAttribute('aria-expanded', 'true');
    const first = modelDropdown.querySelector<HTMLElement>('[role="option"]');
    first?.focus();
  }

  function closeDropdown(returnFocus = true): void {
    modelDropdown.hidden = true;
    modelFilterBtn.setAttribute('aria-expanded', 'false');
    if (returnFocus) modelFilterBtn.focus();
  }

  modelFilterBtn.addEventListener('click', () => {
    if (modelDropdown.hidden) { openDropdown(); } else { closeDropdown(false); }
  });

  modelFilterBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDropdown(); }
  });

  modelDropdown.addEventListener('keydown', (e) => {
    const options = [...modelDropdown.querySelectorAll<HTMLElement>('[role="option"]')];
    const focused = document.activeElement as HTMLElement;
    const idx = options.indexOf(focused);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      options[Math.min(idx + 1, options.length - 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx <= 0) closeDropdown();
      else options[idx - 1]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      focused.click();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      closeDropdown(e.key === 'Escape');
    }
  });

  document.addEventListener('click', (e) => {
    if (!modelFilterEl.contains(e.target as Node)) closeDropdown(false);
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
    allOpt.setAttribute('tabindex', '-1');
    allOpt.id = 'model-opt-all';
    allOpt.setAttribute('aria-selected', String(activeModels.length === 0));
    allOpt.dataset.model = '__all__';
    const allIcon = document.createElement('i');
    allIcon.className = `codicon codicon-${activeModels.length === 0 ? 'check' : 'blank'}`;
    allIcon.setAttribute('aria-hidden', 'true');
    allOpt.appendChild(allIcon);
    allOpt.append(' All models');
    allOpt.addEventListener('click', () => {
      activeModels = [];
      updateModelLabel();
      rebuildModelDropdown(allModels);
      dispatchFilter();
    });
    modelDropdown.appendChild(allOpt);

    allModels.forEach((m, i) => {
      const opt = document.createElement('div');
      opt.className = 'wv-model-option';
      opt.setAttribute('role', 'option');
      opt.setAttribute('tabindex', '-1');
      opt.id = `model-opt-${i}`;
      opt.setAttribute('aria-selected', String(activeModels.includes(m)));
      opt.dataset.model = m;
      const icon = document.createElement('i');
      icon.className = `codicon codicon-${activeModels.includes(m) ? 'check' : 'blank'}`;
      icon.setAttribute('aria-hidden', 'true');
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
    });
  }

  const surfaceChips = el.querySelector<HTMLElement>('#surface-chips')!;
  const sourceChips = el.querySelector<HTMLElement>('#source-chips')!;

  function updateSurfaceUI() {
    surfaceChips.querySelectorAll<HTMLElement>('[data-surface]').forEach((c) => {
      const sv = c.dataset.surface;
      c.setAttribute(
        'aria-pressed',
        String(sv === '__all__' ? activeSurface === null : activeSurface === sv),
      );
    });
  }

  function updateSourceUI() {
    sourceChips.querySelectorAll<HTMLElement>('[data-source-group]').forEach((c) => {
      const grp = c.dataset.sourceGroup;
      let pressed: boolean;
      if (grp === '__all__') {
        pressed = activeSources.length === 0;
      } else if (grp === 'copilot') {
        pressed = activeSources.length > 0 && !activeSources.includes('claude-code');
      } else {
        pressed = activeSources.includes('claude-code') && activeSources.length === 1;
      }
      c.setAttribute('aria-pressed', String(pressed));
    });
  }

  updatePresetUI();

  return {
    update(s: UsageSnapshot, metric: Metric) {
      // Sync with externally-set filter state (e.g. model spotlight from chart click)
      activeModels = state().filter.models ?? [];
      activePreset = state().datePreset;
      updatePresetUI();
      updateMetricUI(metric);

      if (s.allRepos.length > 1) {
        repoSelect.hidden = false;
        rebuildRepoSelect(s.allRepos);
      } else {
        repoSelect.hidden = true;
        activeRepos = [];
      }

      if (s.allModels.length > 1) {
        modelFilterEl.hidden = false;
        rebuildModelDropdown(s.allModels);
      } else {
        modelFilterEl.hidden = true;
        activeModels = [];
      }

      if (s.allSurfaces.length > 1) {
        surfaceChips.hidden = false;
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
        surfaceChips.hidden = true;
        activeSurface = null;
      }

      // Show the source filter only when both Copilot and Claude Code are present.
      const hasCopilot = s.allSources.some((src) => COPILOT_SOURCES.includes(src));
      const hasClaudeCode = s.allSources.includes('claude-code');
      if (hasCopilot && hasClaudeCode) {
        sourceChips.hidden = false;
        sourceChips.innerHTML = '';

        const sourceOptions: Array<{ group: string; label: string; sources: SourceKind[] }> = [
          { group: '__all__', label: 'All', sources: [] },
          { group: 'copilot', label: 'Copilot', sources: COPILOT_SOURCES },
          { group: 'claude-code', label: 'Claude Code', sources: ['claude-code'] },
        ];
        for (const opt of sourceOptions) {
          const chip = document.createElement('button');
          chip.className = 'wv-source-chip';
          chip.dataset.sourceGroup = opt.group;
          chip.setAttribute('aria-pressed', 'false');
          chip.textContent = opt.label;
          chip.addEventListener('click', () => {
            activeSources = opt.sources;
            updateSourceUI();
            dispatchFilter();
          });
          sourceChips.appendChild(chip);
        }
        updateSourceUI();
      } else {
        sourceChips.hidden = true;
        activeSources = [];
      }
    },
  };
}
