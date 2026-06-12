import { UsageSnapshot } from '../../src/model/types';

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
  const text = banner.querySelector<HTMLElement>('.wv-banner-text')!;

  return {
    update(s: UsageSnapshot) {
      const { source, status } = s;
      let kind: 'ok' | 'warn' | 'sample' = 'ok';
      let msg = '';

      if (source === 'sample') {
        kind = 'sample';
        msg = 'Sample data — usage estimates from synthetic events';
      } else if (source === 'local') {
        msg = 'Local estimates — install GitHub Copilot to improve accuracy';
      } else if (source === 'lm') {
        msg = 'Tracking @weevil conversations — accurate counts';
      } else {
        msg = 'Connected';
      }

      if (status.kind === 'degraded') {
        kind = 'warn';
        msg += ` (degraded: ${status.reason ?? ''})`;
      }

      banner.dataset.kind = kind;
      text.textContent = msg;
    },
  };
}
