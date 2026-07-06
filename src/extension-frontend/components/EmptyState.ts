import { post } from '../api';

export interface EmptyStateHandle {
  update(visible: boolean, reason?: string): void;
}

export function mountEmptyState(el: HTMLElement): EmptyStateHandle {
  el.innerHTML = `
    <div class="wv-empty" role="status">
      <i class="codicon codicon-broadcast wv-empty-icon" aria-hidden="true"></i>
      <h2 class="wv-empty-title">No signal yet</h2>
      <p class="wv-empty-body">
        Mallard reads Copilot's local OTel log files automatically.<br/>
        No log files were found at the expected location.
      </p>
      <ol class="wv-empty-steps">
        <li>Make sure GitHub Copilot is installed and you have used it recently.</li>
        <li>Run <strong>Mallard: Show Detected Log Path</strong> to verify discovery.</li>
        <li>If no path is found, set <code>mallard.copilotLogPath</code> in settings.</li>
      </ol>
      <div class="wv-empty-actions">
        <button class="wv-btn wv-btn--primary" id="empty-refresh">
          <i class="codicon codicon-refresh"></i> Refresh
        </button>
        <button class="wv-btn" id="empty-signin">
          <i class="codicon codicon-github"></i> Sign in to verify spend
        </button>
        <button class="wv-btn" id="empty-enable-copilot">
          <i class="codicon codicon-broadcast"></i> Enable Copilot tracking
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
  el.querySelector('#empty-enable-copilot')!.addEventListener('click', () => {
    post({ type: 'command', id: 'enableCopilotTelemetry' });
  });

  return {
    update(visible: boolean, msg?: string) {
      el.style.display = visible ? '' : 'none';
      reason.textContent = msg ?? '';
    },
  };
}
