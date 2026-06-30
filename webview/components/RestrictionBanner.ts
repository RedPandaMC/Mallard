/**
 * Banner above the dashboard's filter bar. Reads the snapshot's
 * `restriction` field (sent by the host whenever the restriction engine
 * changes state) and renders the appropriate affordance.
 */
import { RestrictionState } from '../../src/client_extension/domain/types';
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
  return {
    update(state) {
      if (!state || !state.active) {
        el.innerHTML = '';
        el.style.display = 'none';
        return;
      }
      const now = Date.now();
      const inGrace = state.graceExpiresAt !== null && state.graceExpiresAt > now;
      const isOverridden = state.userOverrideUntil !== null && state.userOverrideUntil > now;
      const mode = inGrace ? 'grace' : isOverridden ? 'override' : 'active';
      el.style.display = '';
      if (mode === 'override') {
        const m = Math.max(1, Math.round((state.userOverrideUntil! - now) / 60_000));
        el.innerHTML = `<div class="wv-restrict-banner wv-restrict-override" role="status">
          <i class="codicon codicon-debug-pause"></i>
          <span>Override active for ${m}m. Restriction rule <code>${escape(state.ruleId)}</code> will resume after that.</span>
        </div>`;
        return;
      }
      if (mode === 'grace') {
        const m = Math.max(1, Math.round((state.graceExpiresAt! - now) / 60_000));
        el.innerHTML = `<div class="wv-restrict-banner wv-restrict-grace" role="status">
          <i class="codicon codicon-watch"></i>
          <span><strong>${escape(state.reasonMessage)}</strong> — Copilot will be restricted in ${m}m.</span>
          <span class="wv-restrict-actions">
            <button class="wv-btn wv-btn--sm" id="restrict-snooze"><i class="codicon codicon-clock"></i> Snooze 1h</button>
            <button class="wv-btn wv-btn--sm wv-btn--primary" id="restrict-now"><i class="codicon codicon-shield"></i> Restrict now</button>
          </span>
        </div>`;
        el.querySelector('#restrict-snooze')!.addEventListener('click', () => {
          post({ type: 'restrictSnooze', minutes: 60 });
        });
        el.querySelector('#restrict-now')!.addEventListener('click', () => {
          post({ type: 'restrictNow' });
        });
        return;
      }
      // active
      el.innerHTML = `<div class="wv-restrict-banner wv-restrict-active" role="alert">
        <i class="codicon codicon-shield"></i>
        <span><strong>Copilot is restricted.</strong> ${escape(state.reasonMessage)}</span>
        <span class="wv-restrict-actions">
          <button class="wv-btn wv-btn--sm" id="restrict-1h"><i class="codicon codicon-clock"></i> Re-enable 1h</button>
          <button class="wv-btn wv-btn--sm" id="restrict-midnight"><i class="codicon codicon-moon"></i> Until midnight</button>
          <button class="wv-btn wv-btn--sm" id="restrict-permanent"><i class="codicon codicon-unlock"></i> Permanently</button>
        </span>
      </div>`;
      el.querySelector('#restrict-1h')!.addEventListener('click', () => {
        post({ type: 'restrictSnooze', minutes: 60 });
      });
      el.querySelector('#restrict-midnight')!.addEventListener('click', () => {
        const midnight = new Date();
        midnight.setHours(24, 0, 0, 0);
        const minutes = Math.max(1, Math.round((midnight.getTime() - Date.now()) / 60_000));
        post({ type: 'restrictSnooze', minutes });
      });
      el.querySelector('#restrict-permanent')!.addEventListener('click', () => {
        if (
          window.confirm(
            'Re-enable Copilot permanently? The restriction rule will not auto-disable again until you remove or edit the rule.',
          )
        ) {
          post({ type: 'restrictPermanent' });
        }
      });
    },
  };
}
