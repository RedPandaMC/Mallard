import { UsageSnapshot } from '../../src/client_extension/domain/types';

export interface StatusBannerHandle {
  update(snapshot: UsageSnapshot): void;
}

export function mountStatusBanner(el: HTMLElement): StatusBannerHandle {
  el.innerHTML = `
    <div class="wv-banner" role="status" aria-live="polite" data-kind="ok">
      <span class="wv-banner-dot" aria-hidden="true"></span>
      <span class="wv-banner-text"></span>
    </div>`;

  const banner = el.querySelector<HTMLElement>('.wv-banner')!;
  const dot = banner.querySelector<HTMLElement>('.wv-banner-dot')!;
  const text = banner.querySelector<HTMLElement>('.wv-banner-text')!;

  return {
    update(s: UsageSnapshot) {
      const { status } = s;
      let kind: 'ok' | 'warn' | 'empty' | 'loading' = 'ok';
      let msg = '';

      if (status.kind === 'loading') {
        kind = 'loading';
        msg = status.reason ?? 'Reading log files…';
      } else if (status.kind === 'empty') {
        kind = 'empty';
        msg = status.reason ?? 'No usage data found';
      } else if (status.kind === 'degraded') {
        kind = 'warn';
        msg = `Degraded: ${status.reason ?? 'parse errors in log files'}`;
      } else {
        msg = status.reason ?? 'Tracking from local Copilot logs';
      }

      banner.dataset.kind = kind;
      text.textContent = msg;

      // Briefly flash the dot when a live incremental update arrives.
      if (s.isIncremental && kind === 'ok') {
        dot.classList.remove('wv-banner-dot--flash');
        void dot.offsetWidth; // force reflow to restart the animation
        dot.classList.add('wv-banner-dot--flash');
      }
    },
  };
}
