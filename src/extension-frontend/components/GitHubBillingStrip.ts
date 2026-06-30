/**
 * Thin strip below the KPI cards showing GitHub billing verification status.
 *
 * - signed-out  → "Sign in to verify spend" link
 * - signed-in   → "✓ Verified by GitHub · $X.XX actual"
 * - divergence  → yellow warning when local estimate differs from API by >10%
 */
import { AuthStatus, UsageSnapshot } from '../../src/extension/domain/types';
import { formatMoney } from '../../src/extension/domain/format';
import { post } from '../api';

export interface GitHubBillingStripHandle {
  update(snapshot: UsageSnapshot): void;
}

export function mountGitHubBillingStrip(el: HTMLElement): GitHubBillingStripHandle {
  return {
    update(s: UsageSnapshot) {
      el.innerHTML = '';
      const status: AuthStatus = s.authStatus;

      if (status === 'signed-out') {
        const btn = document.createElement('button');
        btn.className = 'wv-gh-cta';
        btn.innerHTML = '<i class="codicon codicon-account"></i> Sign in to verify spend';
        btn.addEventListener('click', () => post({ type: 'command', id: 'signIn' }));
        el.appendChild(btn);
        return;
      }

      if (status === 'signed-in' && s.githubBilling) {
        const { totalNetAmount, quota } = s.githubBilling;
        const currency = s.currency;

        const row = document.createElement('div');
        row.className = 'wv-gh-verified';

        const badge = document.createElement('span');
        badge.className = 'wv-gh-badge';
        badge.innerHTML = '<i class="codicon codicon-verified-filled"></i> Verified by GitHub';

        const amount = document.createElement('span');
        amount.className = 'wv-gh-amount';
        amount.textContent = `${formatMoney(totalNetAmount, currency)} actual`;

        row.appendChild(badge);
        row.appendChild(amount);

        // Quota reset date
        if (quota?.resetDate) {
          const reset = document.createElement('span');
          reset.className = 'wv-gh-reset';
          const d = new Date(quota.resetDate);
          reset.textContent = `Resets ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
          row.appendChild(reset);
        }

        el.appendChild(row);

        // Divergence warning
        const localCost = s.budget.usedCost;
        if (totalNetAmount > 0) {
          const divergence = Math.abs(localCost - totalNetAmount) / totalNetAmount;
          if (divergence > 0.1) {
            const warn = document.createElement('div');
            warn.className = 'wv-gh-divergence';
            const icon = document.createElement('i');
            icon.className = 'codicon codicon-warning';
            icon.setAttribute('aria-hidden', 'true');
            warn.appendChild(icon);
            warn.append(
              ` Local estimate (${formatMoney(localCost, currency)}) differs from API ` +
              `(${formatMoney(totalNetAmount, currency)}). Other devices may account for the difference.`,
            );
            el.appendChild(warn);
          }
        }
      }
    },
  };
}
