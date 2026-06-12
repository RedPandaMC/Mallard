import { GRANULARITIES, Granularity } from '../../src/model/types';
import { post } from '../api';

const LABELS: Record<Granularity, string> = {
  hour: 'Hour',
  day: 'Day',
  week: 'Week',
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year',
};

export interface GranularityTabsHandle {
  update(granularity: Granularity): void;
}

export function mountGranularityTabs(
  el: HTMLElement,
  onChange: (g: Granularity) => void,
): GranularityTabsHandle {
  el.setAttribute('role', 'tablist');
  el.setAttribute('aria-label', 'Time granularity');
  el.classList.add('wv-gran-tabs');
  el.innerHTML = '';

  const buttons: Record<Granularity, HTMLButtonElement> = {} as never;

  for (const g of GRANULARITIES) {
    const btn = document.createElement('button');
    btn.className = 'wv-gran-tab';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.setAttribute('data-gran', g);
    btn.textContent = LABELS[g];

    btn.addEventListener('click', () => {
      onChange(g);
      post({ type: 'setGranularity', value: g });
    });

    btn.addEventListener('keydown', (e: KeyboardEvent) => {
      const idx = GRANULARITIES.indexOf(g);
      let next = -1;
      if (e.key === 'ArrowRight') next = (idx + 1) % GRANULARITIES.length;
      if (e.key === 'ArrowLeft') next = (idx - 1 + GRANULARITIES.length) % GRANULARITIES.length;
      if (next !== -1) {
        e.preventDefault();
        buttons[GRANULARITIES[next]].focus();
      }
    });

    buttons[g] = btn;
    el.appendChild(btn);
  }

  return {
    update(granularity: Granularity) {
      for (const g of GRANULARITIES) {
        const btn = buttons[g];
        const active = g === granularity;
        btn.setAttribute('aria-selected', String(active));
        btn.tabIndex = active ? 0 : -1;
      }
    },
  };
}
