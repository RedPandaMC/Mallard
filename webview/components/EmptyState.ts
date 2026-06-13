import { post } from '../api';

export interface EmptyStateHandle {
  update(visible: boolean, reason?: string): void;
}

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" fill="currentColor" aria-hidden="true" class="wv-empty-logo">
  <path d="M30 28 C18 28 8 37 8 48 C8 59 18 68 30 68 C36 68 41 65 45 61 L52 61 C55 66 61 70 68 70 C80 70 90 62 90 52 C90 46 87 40 82 36 C83 34 84 32 84 30 C84 20 76 12 66 12 C60 12 55 15 52 19 L48 19 C45 16 41 14 36 13 C34 28 30 28 30 28Z"/>
  <ellipse cx="25" cy="48" rx="12" ry="8"/>
  <ellipse cx="72" cy="50" rx="14" ry="10"/>
</svg>`;

export function mountEmptyState(el: HTMLElement): EmptyStateHandle {
  el.innerHTML = `
    <div class="wv-empty" role="status">
      ${LOGO_SVG}
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
        <button class="wv-btn" id="empty-settings">
          <i class="codicon codicon-settings-gear"></i> Open settings
        </button>
      </div>
      <p class="wv-empty-reason" id="empty-reason"></p>
    </div>`;

  const reason = el.querySelector<HTMLElement>('#empty-reason')!;

  el.querySelector('#empty-refresh')!.addEventListener('click', () => {
    post({ type: 'refresh' });
  });
  el.querySelector('#empty-settings')!.addEventListener('click', () => {
    post({ type: 'command', id: 'openSettings' });
  });

  return {
    update(visible: boolean, msg?: string) {
      el.style.display = visible ? '' : 'none';
      reason.textContent = msg ?? '';
    },
  };
}
