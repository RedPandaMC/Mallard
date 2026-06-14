import { post } from '../api';

export interface EmptyStateHandle {
  update(visible: boolean, reason?: string): void;
}

export function mountEmptyState(el: HTMLElement): EmptyStateHandle {
  const logo = document.body.dataset.logo ?? '';
  el.innerHTML = `
    <div class="wv-empty" role="status">
      <img class="wv-empty-logo" src="${logo}" alt="" aria-hidden="true" />
      <h2 class="wv-empty-title">Nothing tracked yet</h2>
      <p class="wv-empty-body">
        Weevil reads Copilot's local OTel log files automatically.<br/>
        No log files were found at the expected location.
      </p>
      <ol class="wv-empty-steps">
        <li>Make sure GitHub Copilot is installed and you have used it recently.</li>
        <li>Run <strong>Weevil: Show Detected Log Path</strong> to verify discovery.</li>
        <li>If no path is found, set <code>weevil.copilotLogPath</code> in settings.</li>
      </ol>
      <div class="wv-empty-actions">
        <button class="wv-btn wv-btn--primary" id="empty-refresh">
          <i class="codicon codicon-refresh"></i> Refresh
        </button>
        <button class="wv-btn" id="empty-signin">
          <i class="codicon codicon-account"></i> Sign in to verify spend
        </button>
      </div>
      <p class="wv-empty-reason" id="empty-reason"></p>
    </div>`;

  const reason = el.querySelector<HTMLElement>('#empty-reason')!;

  el.querySelector('#empty-refresh')!.addEventListener('click', () => {
    post({ type: 'refresh' });
  });
  el.querySelector('#empty-signin')!.addEventListener('click', () => {
    post({ type: 'command', id: 'signIn' });
  });

  return {
    update(visible: boolean, msg?: string) {
      el.style.display = visible ? '' : 'none';
      reason.textContent = msg ?? '';
    },
  };
}
