/**
 * Banner above the dashboard's filter bar. Reads the snapshot's
 * `restriction` field (sent by the host whenever the restriction engine
 * changes state) and renders the appropriate affordance.
 */
import { RestrictionState } from '../../extension-backend/domain/types';
import { post } from '../api';

export interface RestrictionBannerHandle {
  update(state: RestrictionState | null): void;
}

function escape(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function mountRestrictionBanner(el: HTMLElement): RestrictionBannerHandle {
  let dismissedKey: string | null = null;
  return {
    update(state) {
      if (!state || !state.active) {
        dismissedKey = null;
        el.innerHTML = '';
        el.style.display = 'none';
        return;
      }
      const now = Date.now();
      const isOverridden = state.userOverrideUntil !== null && state.userOverrideUntil > now;
      if (isOverridden) {
        const m = Math.max(1, Math.round((state.userOverrideUntil! - now) / 60_000));
        el.style.display = '';
        el.innerHTML = `<div class="wv-restrict-banner wv-restrict-override" role="status">
          <i class="codicon codicon-debug-pause"></i>
          <span>Snoozed for ${m}m. Rule <code>${escape(state.ruleId)}</code> will show again after that.</span>
        </div>`;
        return;
      }
      const key = `${state.ruleId}:${state.firedAt}`;
      if (dismissedKey === key) {
        el.innerHTML = '';
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      el.innerHTML = `<div class="wv-restrict-banner wv-restrict-active" role="alert">
        <i class="codicon codicon-bell"></i>
        <span><strong>${escape(state.reasonMessage)}</strong></span>
        <span class="wv-restrict-actions">
          <button class="wv-btn wv-btn--sm" id="restrict-dismiss"><i class="codicon codicon-close"></i> Dismiss</button>
          <button class="wv-btn wv-btn--sm" id="restrict-snooze-15"><i class="codicon codicon-clock"></i> Snooze 15m</button>
          <button class="wv-btn wv-btn--sm" id="restrict-snooze-60"><i class="codicon codicon-clock"></i> Snooze 1h</button>
          <button class="wv-btn wv-btn--sm" id="restrict-disable"><i class="codicon codicon-circle-slash"></i> Disable Mallard…</button>
        </span>
      </div>`;
      el.querySelector('#restrict-dismiss')!.addEventListener('click', () => {
        dismissedKey = key;
        el.innerHTML = '';
        el.style.display = 'none';
      });
      el.querySelector('#restrict-snooze-15')!.addEventListener('click', () => {
        post({ type: 'restrictSnooze', minutes: 15 });
      });
      el.querySelector('#restrict-snooze-60')!.addEventListener('click', () => {
        post({ type: 'restrictSnooze', minutes: 60 });
      });
      el.querySelector('#restrict-disable')!.addEventListener('click', () => {
        post({ type: 'command', id: 'disableExtension' });
      });
    },
  };
}
