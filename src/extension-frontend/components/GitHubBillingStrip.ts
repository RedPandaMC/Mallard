/**
 * Thin strip below the KPI cards showing GitHub billing verification status.
 *
 * - signed-out  → light "Not verified" text pointing at the header's sign-in
 *                 button (the primary CTA lives in the header now, so this
 *                 doesn't duplicate a full button)
 * - signed-in   → "✓ Verified by GitHub · $X.XX actual"
 * - error       → the reason, plus a "Set PAT" action when a PAT is required
 * - divergence  → yellow warning when local estimate differs from API by >10%
 */
import { AuthStatus, UsageSnapshot } from '../../extension-backend/domain/types';
import { formatMoney } from '../../extension-backend/domain/format';
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
        const note = document.createElement('span');
        note.className = 'wv-gh-unverified';
        note.textContent = 'Spend not verified — sign in to GitHub from the header for an authoritative total.';
        el.appendChild(note);
        return;
      }

      if (status === 'error') {
        const row = document.createElement('div');
        row.className = 'wv-gh-error';
        const icon = document.createElement('i');
        icon.className = 'codicon codicon-warning';
        icon.setAttribute('aria-hidden', 'true');
        row.appendChild(icon);
        row.append(' ' + (s.authError ?? 'GitHub sign-in failed.'));

        if (s.authError?.includes('Personal Access Token')) {
          const patBtn = document.createElement('button');
          patBtn.className = 'wv-btn wv-btn--sm';
          patBtn.textContent = 'Set PAT';
          patBtn.addEventListener('click', () => post({ type: 'command', id: 'setGitHubPat' }));
          row.appendChild(patBtn);
        } else {
          const retryBtn = document.createElement('button');
          retryBtn.className = 'wv-btn wv-btn--sm';
          retryBtn.textContent = 'Retry';
          retryBtn.addEventListener('click', () => post({ type: 'command', id: 'signIn' }));
          row.appendChild(retryBtn);
        }
        el.appendChild(row);
        return;
      }

      if (status === 'signed-in' && s.githubBilling) {
        const { totalNetAmount, quota } = s.githubBilling;
        const currency = s.currency;
        // githubBilling amounts are USD from the GitHub API while
        // budget.usedCost is already fx-converted — convert before rendering
        // or comparing, otherwise every non-USD display currency mislabels the
        // "actual" figure and trips false divergence warnings.
        const fxRate = currency !== 'USD' ? (s.fxRates[currency] ?? 1) : 1;
        const actualCost = totalNetAmount * fxRate;

        const row = document.createElement('div');
        row.className = 'wv-gh-verified';

        const badge = document.createElement('span');
        badge.className = 'wv-gh-badge';
        badge.innerHTML = '<i class="codicon codicon-verified-filled"></i> Verified by GitHub';

        const amount = document.createElement('span');
        amount.className = 'wv-gh-amount';
        amount.textContent = `${formatMoney(actualCost, currency)} actual`;

        row.appendChild(badge);
        row.appendChild(amount);

        // Quota reset date — guard against an unparsable string so we never
        // render the literal "Resets Invalid Date"; hide the field instead.
        if (quota?.resetDate) {
          const d = new Date(quota.resetDate);
          if (!Number.isNaN(d.getTime())) {
            const reset = document.createElement('span');
            reset.className = 'wv-gh-reset';
            reset.textContent = `Resets ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
            row.appendChild(reset);
          }
        }

        el.appendChild(row);

        // Divergence warning — both sides in display currency
        const localCost = s.budget.usedCost;
        if (actualCost > 0) {
          const divergence = Math.abs(localCost - actualCost) / actualCost;
          if (divergence > 0.1) {
            const warn = document.createElement('div');
            warn.className = 'wv-gh-divergence';
            const icon = document.createElement('i');
            icon.className = 'codicon codicon-warning';
            icon.setAttribute('aria-hidden', 'true');
            warn.appendChild(icon);
            warn.append(
              ` Local estimate (${formatMoney(localCost, currency)}) differs from API ` +
              `(${formatMoney(actualCost, currency)}). Other devices may account for the difference.`,
            );
            el.appendChild(warn);
          }
        }
      }
    },
  };
}
