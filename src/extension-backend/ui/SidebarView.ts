/**
 * Activity-bar sidebar: shows a live budget gauge and ranked model list.
 * Implemented as a WebviewView so it can display rich HTML rather than a
 * plain tree. Clicking the Mallard icon in the activity bar reveals this
 * panel; clicking "Open Dashboard" opens the full webview panel.
 */
import * as vscode from 'vscode';
import { UsageService } from '../app/UsageService';
import { getNonce } from '../util/nonce';
import { isHostBoundMsg, WebviewBoundMsg } from './messaging';

export class SidebarView implements vscode.WebviewViewProvider {
  static readonly viewType = 'mallard.sidebar';

  private readonly disposables: vscode.Disposable[] = [];

  /** Guard against auto-opening on the first visibility event at startup. */
  private static readonly STARTUP_GUARD_MS = 1500;
  private readonly activatedAt = Date.now();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly usage: UsageService,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };

    webviewView.webview.html = this.buildHtml(webviewView.webview);

    // Typed, validated outbound envelope — same discriminated union the main
    // dashboard bridge uses, so a snapshot-shape change is a compile error here
    // instead of silently posting a malformed message.
    const post = (msg: WebviewBoundMsg): void => {
      void webviewView.webview.postMessage(msg);
    };

    webviewView.webview.onDidReceiveMessage(
      (raw: unknown) => {
        if (!isHostBoundMsg(raw)) return; // reject unvalidated/unknown messages
        switch (raw.type) {
          case 'ready': {
            const s = this.usage.current;
            if (s) post({ type: 'snapshot', payload: s });
            break;
          }
          case 'command':
            if (raw.id === 'openDashboard') {
              void vscode.commands.executeCommand('mallard.openDashboard');
            }
            break;
          case 'toggleModelFilter':
            void this.toggleModelFilter(raw.model);
            break;
          default:
            break; // other host-bound messages aren't used by the sidebar
        }
      },
      null,
      this.disposables,
    );

    this.disposables.push(
      this.usage.onDidChangeSnapshot(() => {
        const s = this.usage.current;
        if (s) post({ type: 'snapshot', payload: s });
      }),
      this.usage.onAlertFired(({ message }) => post({ type: 'alertFired', message })),
    );

    // Open the dashboard when the user clicks the activity-bar icon,
    // but skip the very first visibility event (panel was open on startup).
    webviewView.onDidChangeVisibility(() => {
      if (!webviewView.visible) return;
      if (Date.now() - this.activatedAt < SidebarView.STARTUP_GUARD_MS) return;
      void vscode.commands.executeCommand('mallard.openDashboard');
    }, null, this.disposables);
  }

  /**
   * Toggles a model in/out of the shared filter's model list — dual-
   * connected with the main webview's model dropdown, since both read and
   * write the same UsageService filter and both re-render from the
   * resulting snapshot's `filter.models`.
   */
  private async toggleModelFilter(model: string): Promise<void> {
    const current = new Set(this.usage.current?.filter.models ?? []);
    if (current.has(model)) current.delete(model);
    else current.add(model);
    const filter = { ...(this.usage.current?.filter ?? {}) };
    if (current.size > 0) filter.models = [...current];
    else delete filter.models;
    await this.usage.setFilter(filter);
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'mallard-icon-128.png'),
    );
    // style-src 'unsafe-inline' is required (assessed July 2026): the inline
    // <style> block below, the dynamic width/opacity style attributes on the
    // model bars, and VS Code's own un-nonced _defaultStyles injection all
    // need it. Style-only exposure — scripts stay nonce-locked.
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource}`,
      `style-src 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta http-equiv="Content-Security-Policy" content="${csp}"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, -apple-system, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: transparent;
      line-height: 1.4;
    }
    button { font: inherit; cursor: pointer; background: none; border: none; }

    .sb { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

    /* ── header ────────────────────────────── */
    .sb-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px 8px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2));
    }
    .sb-logo { width: 20px; height: 20px; object-fit: contain; flex-shrink: 0; }
    .sb-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--vscode-foreground);
      flex: 1;
    }
    .sb-open-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 500;
      color: var(--vscode-button-foreground, #fff);
      background: var(--vscode-button-background, #e5231b);
      border-radius: 3px;
      white-space: nowrap;
    }
    .sb-open-btn:hover {
      background: var(--vscode-button-hoverBackground,
        color-mix(in srgb, var(--vscode-button-background, #e5231b) 85%, #000));
    }

    /* ── scroll area ───────────────────────── */
    .sb-body { flex: 1; overflow-y: auto; padding: 0 0 8px; }

    /* ── section ───────────────────────────── */
    .sb-section { padding: 10px 12px 0; }
    .sb-section-label {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 6px;
    }

    /* ── budget ────────────────────────────── */
    .sb-budget-numbers {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 4px;
      margin-bottom: 6px;
    }
    .sb-budget-spend {
      font-size: 18px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
      color: var(--sb-sev, var(--vscode-foreground));
    }
    .sb-budget-cap {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .sb-budget-pct {
      font-size: 11px;
      font-weight: 600;
      color: var(--sb-sev, var(--vscode-descriptionForeground));
    }
    /* Segmented gauge — mirrors the dashboard's SpendGauge visual language
       (a row of small bars lighting up left to right) at a size that fits
       the narrow sidebar. Scale runs to 120% so overage is still visible. */
    .sb-gauge-segments {
      display: flex;
      gap: 1px;
      height: 10px;
      margin-bottom: 4px;
    }
    .sb-gauge-seg {
      flex: 1;
      border-radius: 1px;
      background: var(--vscode-panel-border, rgba(128,128,128,.2));
    }
    .sb-gauge-seg--on { background: var(--sb-sev, #e5231b); }
    .sb-budget-sub {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
    }
    /* Brief highlight on the budget section the moment an alert fires —
       distinct from the passive severity coloring above, which only
       reflects the latest percentage. */
    @keyframes sb-alert-pulse {
      0%, 100% { background: transparent; }
      30% { background: color-mix(in srgb, var(--sb-sev, #e5231b) 18%, transparent); }
    }
    .sb-section--pulse { animation: sb-alert-pulse 1.4s ease; border-radius: 4px; }
    .sb-divider {
      height: 1px;
      background: var(--vscode-panel-border, rgba(128,128,128,.15));
      margin: 10px 12px 0;
    }

    /* ── model list ────────────────────────── */
    .sb-model-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 6px;
      align-items: center;
      padding: 4px 12px;
      width: 100%;
      text-align: left;
      cursor: pointer;
      border-radius: 3px;
    }
    .sb-model-row:hover { background: var(--vscode-list-hoverBackground); }
    .sb-model-row--selected {
      background: var(--vscode-list-activeSelectionBackground, rgba(229,35,27,0.12));
      outline: 1px solid var(--vscode-focusBorder, #e5231b);
      outline-offset: -1px;
    }
    .sb-model-info { min-width: 0; }
    .sb-model-name {
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--vscode-foreground);
      margin-bottom: 3px;
    }
    .sb-model-bar-track {
      height: 3px;
      border-radius: 1.5px;
      background: var(--vscode-panel-border, rgba(128,128,128,.2));
      overflow: hidden;
    }
    .sb-model-bar-fill {
      height: 100%;
      border-radius: 1.5px;
    }
    .sb-model-credits {
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      color: var(--vscode-descriptionForeground);
      text-align: right;
      white-space: nowrap;
    }

    /* ── loading / empty ───────────────────── */
    .sb-empty {
      padding: 24px 12px;
      text-align: center;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .sb-empty-title { font-weight: 600; margin-bottom: 4px; }

    /* ── severity ──────────────────────────── */
    .sb--warn { --sb-sev: #ff8a80; }
    .sb--err  { --sb-sev: #e5231b; }
  </style>
</head>
<body>
  <div class="sb" id="sb">
    <header class="sb-header">
      <img src="${logoUri}" class="sb-logo" alt=""/>
      <span class="sb-title">Mallard</span>
      <button class="sb-open-btn" id="open-btn" title="Open full dashboard">↗</button>
    </header>
    <div class="sb-body" id="body">
      <div class="sb-empty">
        <div class="sb-empty-title">Reading logs…</div>
        <div>Tracking will start shortly</div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.getElementById('open-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'command', id: 'openDashboard' });
    });

    function fmt(n) {
      if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
      return String(Math.round(n));
    }
    function fmtMoney(amount, currency) {
      const digits = amount >= 100 ? 0 : amount >= 1 ? 2 : 3;
      try {
        return new Intl.NumberFormat(undefined, {
          style: 'currency', currency: currency || 'USD',
          minimumFractionDigits: digits, maximumFractionDigits: digits,
        }).format(amount);
      } catch {
        return (currency || 'USD') + ' ' + amount.toFixed(digits);
      }
    }

    const SEGMENTS = 20;
    const SCALE_MAX = 120;

    function render(snap) {
      const budget = snap.budget;
      const hasBudget = budget && budget.monthly != null && budget.monthly > 0;
      const pct = hasBudget
        ? Math.min(120, Math.round((budget.usedCost / budget.monthly) * 100))
        : null;
      const sev = pct == null ? '' : pct >= 100 ? 'sb--err' : pct >= 80 ? 'sb--warn' : '';
      const mtdCost = snap.budget?.usedCost ?? 0;
      const currency = snap.currency || 'USD';
      const models = snap.topModels ?? [];
      const maxCr = models[0]?.credits ?? 1;

      let html = '';

      // Budget
      html += '<div class="sb-section" id="budget-section">';
      html += '<div class="sb-section-label">Budget</div>';
      if (hasBudget) {
        const lit = Math.round((Math.min(pct, SCALE_MAX) / SCALE_MAX) * SEGMENTS);
        let segs = '';
        for (let i = 0; i < SEGMENTS; i++) {
          segs += '<div class="sb-gauge-seg' + (i < lit ? ' sb-gauge-seg--on' : '') + '"></div>';
        }
        html += '<div class="sb-budget-numbers ' + sev + '">';
        html += '<span class="sb-budget-spend">' + fmtMoney(mtdCost, currency) + '</span>';
        html += '<span class="sb-budget-cap">/ ' + fmtMoney(budget.monthly, currency) + '</span>';
        html += '<span class="sb-budget-pct">' + pct + '%</span>';
        html += '</div>';
        html += '<div class="sb-gauge-segments ' + sev + '">' + segs + '</div>';
        html += '<div class="sb-budget-sub">today ' + fmtMoney(snap.today.cost, currency) + '</div>';
      } else {
        html += '<div class="sb-budget-numbers">';
        html += '<span class="sb-budget-spend">' + fmtMoney(mtdCost, currency) + '</span>';
        html += '<span class="sb-budget-cap">this month</span>';
        html += '</div>';
        html += '<div class="sb-budget-sub">today ' + fmtMoney(snap.today.cost, currency) + '</div>';
      }
      html += '</div>';

      // Models — clickable, dual-connected with the main dashboard's model
      // filter dropdown (both read/write the same UsageService filter).
      if (models.length > 0) {
        const selected = new Set(snap.filter && snap.filter.models ? snap.filter.models : []);
        html += '<div class="sb-divider"></div>';
        html += '<div class="sb-section">';
        html += '<div class="sb-section-label">By model</div>';
        html += '</div>';
        for (let i = 0; i < Math.min(models.length, 8); i++) {
          const m = models[i];
          const isSelected = selected.has(m.key);
          const w = Math.round((m.credits / maxCr) * 100);
          const barOpacities = ['1', '.72', '.50', '.35', '.24', '.16'];
          const barStyle = i === 0
            ? 'background:#e5231b'
            : 'background:var(--vscode-foreground);opacity:' + (barOpacities[i] ?? '.16');
          html += '<button type="button" class="sb-model-row' + (isSelected ? ' sb-model-row--selected' : '')
            + '" data-model="' + escHtml(m.key) + '" aria-pressed="' + isSelected + '">';
          html += '<div class="sb-model-info">';
          html += '<div class="sb-model-name">' + escHtml(m.key) + '</div>';
          html += '<div class="sb-model-bar-track">';
          html += '<div class="sb-model-bar-fill" style="width:' + w + '%;' + barStyle + '"></div>';
          html += '</div></div>';
          html += '<div class="sb-model-credits">' + fmt(m.credits) + ' cr</div>';
          html += '</button>';
        }
      }

      document.getElementById('body').innerHTML = html;
      document.querySelectorAll('.sb-model-row').forEach((row) => {
        row.addEventListener('click', () => {
          vscode.postMessage({ type: 'toggleModelFilter', model: row.dataset.model });
        });
      });
    }

    function escHtml(s) {
      return s.replace(/[&<>"']/g, c =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]
      );
    }

    window.addEventListener('message', e => {
      if (!e.origin.startsWith('vscode-webview://')) return;
      const msg = e.data;
      if (msg.type === 'snapshot') render(msg.payload);
      else if (msg.type === 'alertFired') pulseBudgetSection();
    });

    function pulseBudgetSection() {
      const el = document.getElementById('budget-section');
      if (!el) return;
      el.classList.remove('sb-section--pulse');
      // Force reflow so re-adding the class restarts the animation even if
      // a previous pulse is still running.
      void el.offsetWidth;
      el.classList.add('sb-section--pulse');
    }

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
