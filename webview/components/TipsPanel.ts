import { Tip } from '../../src/model/types';
import { post } from '../api';

export interface TipsPanelHandle {
  update(tip: Tip | null): void;
}

const BULB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" width="16" height="16" aria-hidden="true"><path d="M8 1a5 5 0 0 0-3 9v1a2 2 0 0 0 4 0v-1a5 5 0 0 0-3-9zm1 10H7v1a1 1 0 1 0 2 0v-1z"/></svg>`;

export function mountTipsPanel(el: HTMLElement): TipsPanelHandle {
  el.className = 'wv-tips';
  el.setAttribute('aria-label', 'Usage tip');
  el.innerHTML = `
    <div class="wv-tips-icon" aria-hidden="true">${BULB_SVG}</div>
    <div class="wv-tips-content">
      <div class="wv-tips-title" id="tip-title">Did you know?</div>
      <div class="wv-tips-body" id="tip-body">Loading tip…</div>
    </div>
    <button class="wv-tips-btn" id="tip-next" aria-label="Get another tip">Next tip</button>`;

  const title = el.querySelector<HTMLElement>('#tip-title')!;
  const body = el.querySelector<HTMLElement>('#tip-body')!;
  const btn = el.querySelector<HTMLButtonElement>('#tip-next')!;

  btn.addEventListener('click', () => {
    post({ type: 'requestTip' });
  });

  return {
    update(tip: Tip | null) {
      if (!tip) return;
      title.textContent = tip.title;
      body.textContent = tip.body;
    },
  };
}
