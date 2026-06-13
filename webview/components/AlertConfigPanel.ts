import { UserConfig } from '../../src/domain/types';
import { post } from '../api';

export interface AlertConfigPanelHandle {
  update(config: UserConfig): void;
}

/**
 * In-webview editor for budget, included credits, and alert thresholds. These
 * live in extension globalState (not settings.json); each change posts a
 * `setConfig` message to the host, which persists and recomputes.
 */
export function mountAlertConfigPanel(el: HTMLElement): AlertConfigPanelHandle {
  el.innerHTML = `
    <details class="wv-config" id="wv-config">
      <summary class="wv-config-summary">
        <i class="codicon codicon-settings-gear" aria-hidden="true"></i> Budget &amp; alerts
      </summary>
      <div class="wv-config-body">
        <label class="wv-config-row">
          <span>Monthly budget (USD)</span>
          <input type="number" min="0" step="1" id="cfg-budget" />
        </label>
        <label class="wv-config-row">
          <span>Included credits / month</span>
          <input type="number" min="0" step="1" id="cfg-included" />
        </label>
        <label class="wv-config-row">
          <span>Daily credit alert</span>
          <input type="number" min="0" step="1" id="cfg-daily" />
        </label>
        <label class="wv-config-row wv-config-check">
          <input type="checkbox" id="cfg-velo-on" />
          <span>Alert on fast spending</span>
        </label>
        <label class="wv-config-row">
          <span>Credits / hour threshold</span>
          <input type="number" min="0" step="1" id="cfg-velo-rate" />
        </label>
        <p class="wv-config-note">Zero disables a threshold. Saved instantly.</p>
      </div>
    </details>`;

  const budget = el.querySelector<HTMLInputElement>('#cfg-budget')!;
  const included = el.querySelector<HTMLInputElement>('#cfg-included')!;
  const daily = el.querySelector<HTMLInputElement>('#cfg-daily')!;
  const veloOn = el.querySelector<HTMLInputElement>('#cfg-velo-on')!;
  const veloRate = el.querySelector<HTMLInputElement>('#cfg-velo-rate')!;

  const num = (input: HTMLInputElement) => Math.max(0, Number(input.value) || 0);

  function persist(): void {
    post({
      type: 'setConfig',
      value: {
        monthlyBudget: num(budget),
        includedCredits: num(included),
        dailyCreditAlert: num(daily),
        alerts: {
          velocityEnabled: veloOn.checked,
          velocityCreditsPerHour: num(veloRate),
        },
      },
    });
  }

  for (const input of [budget, included, daily, veloRate]) {
    input.addEventListener('change', persist);
  }
  veloOn.addEventListener('change', persist);

  return {
    update(c: UserConfig) {
      // Don't clobber a field the user is actively editing.
      const active = el.ownerDocument.activeElement;
      if (active !== budget) budget.value = String(c.monthlyBudget);
      if (active !== included) included.value = String(c.includedCredits);
      if (active !== daily) daily.value = String(c.dailyCreditAlert);
      if (active !== veloRate) veloRate.value = String(c.alerts.velocityCreditsPerHour);
      veloOn.checked = c.alerts.velocityEnabled;
    },
  };
}
