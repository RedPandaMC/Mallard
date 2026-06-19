/**
 * Monaco-based editor for the Mallard alert-rule document. The editor hosts
 * a JSON language with a custom schema, completion provider, and hover
 * provider. The preview column on the right shows, for every rule, whether
 * it would fire *now* and the rendered `message` template.
 *
 * Persists via `{ type: 'setConfig', value: <doc> }` after each valid change
 * (debounced 250ms).
 */
import * as monaco from 'monaco-editor';
import { UserConfig } from '../../src/domain/types';
import { evaluateAlertRules } from '../../src/domain/alertRules';
import { checkExpression, getTemplateSnippets, installMonacoProviders } from '../monacoProviders';
import { post } from '../api';

export interface AlertConfigPanelHandle {
  update(config: UserConfig): void;
}

interface PreviewRow {
  ruleId: string;
  severity: 'info' | 'warning' | 'critical';
  fired: boolean;
  message: string;
  active: boolean;
  cooldownLeft: number;
  error?: string;
}

interface PreviewSnapshot {
  rows: PreviewRow[];
  errors: { ruleId: string; field: string; message: string }[];
}

const DEFAULT_DOC = `{
  "version": 2,
  "vars": {
    "dailySoftLimit": 50,
    "dailyHardLimit": 100,
    "premiumModels": ["gpt-4o", "claude-sonnet-4", "o1"]
  },
  "budget": {
    "monthlyUsd": 50,
    "includedCredits": 300
  },
  "groups": [
    {
      "id": "work-hours",
      "label": "Mon–Fri 09:00–17:30",
      "active": "now.weekday in [1,2,3,4,5] and now.hour in [9..17]"
    }
  ],
  "rules": [
    {
      "id": "daily-soft",
      "group": "work-hours",
      "severity": "warning",
      "cooldown": "4h",
      "message": "Daily soft limit of {{$vars.dailySoftLimit}} reached ({{today.credits}} used)",
      "when": "today.credits > $vars.dailySoftLimit"
    },
    {
      "id": "budget-80",
      "severity": "warning",
      "cooldown": "4h",
      "message": "Used 80% of monthly budget",
      "when": "budget.percentOfBudget >= 0.8 and budget.percentOfBudget < 1.0"
    },
    {
      "id": "fast-spending",
      "severity": "warning",
      "cooldown": "1h",
      "message": "Spending at {{velocity.creditsPerHour | round}} credits/hour",
      "when": "velocity.creditsPerHour > 100 and velocity.windowMinutes >= 30"
    }
  ]
}
`;

function severityIcon(sev: 'info' | 'warning' | 'critical'): string {
  if (sev === 'info') return 'codicon-info';
  if (sev === 'warning') return 'codicon-warning';
  return 'codicon-error';
}

function renderPreview(rows: PreviewSnapshot): string {
  if (rows.errors.length > 0) {
    return `<ul class="wv-preview-errors">${rows.errors
      .map(
        (e) =>
          `<li><i class="codicon codicon-error"></i> <code>${escape(e.ruleId)}</code> · ${escape(
            e.field,
          )} — ${escape(e.message)}</li>`,
      )
      .join('')}</ul>`;
  }
  if (rows.rows.length === 0) {
    return `<p class="wv-preview-empty">No rules yet. Insert a template from the toolbar to get started.</p>`;
  }
  return `<ul class="wv-preview">${rows.rows
    .map((r) => {
      const icon = r.fired
        ? `<i class="codicon codicon-pass wv-preview-fired"></i>`
        : `<i class="codicon codicon-circle-outline wv-preview-quiet"></i>`;
      const sev = `<i class="codicon ${severityIcon(r.severity)} wv-preview-sev" title="${r.severity}"></i>`;
      const restrict = r.error
        ? `<i class="codicon codicon-shield wv-preview-restrict" title="${escape(r.error)}"></i>`
        : '';
      const cooldown =
        r.cooldownLeft > 0 ? ` <span class="wv-preview-cooldown">${r.cooldownLeft}m</span>` : '';
      const active = r.active ? '' : ' <span class="wv-preview-inactive">(inactive)</span>';
      return `<li class="wv-preview-row ${r.fired ? 'is-fired' : ''}">
        <div class="wv-preview-head">${icon} ${sev} <code>${escape(r.ruleId)}</code>${active}${cooldown}${restrict}</div>
        <div class="wv-preview-msg">${escape(r.message)}</div>
      </li>`;
    })
    .join('')}</ul>`;
}

function escape(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

export function mountAlertConfigPanel(el: HTMLElement): AlertConfigPanelHandle {
  el.innerHTML = `
    <details class="wv-config" id="wv-config" open>
      <summary class="wv-config-summary">
        <i class="codicon codicon-settings-gear" aria-hidden="true"></i> Alert rules
      </summary>
      <div class="wv-config-body">
        <div class="wv-config-toolbar">
          <button class="wv-btn wv-btn--sm" id="cfg-templates" title="Insert a rule template">
            <i class="codicon codicon-list-selection"></i> Insert template…
          </button>
          <button class="wv-btn wv-btn--sm" id="cfg-vars" title="Insert a variable reference">
            <i class="codicon codicon-symbol-variable"></i> Insert variable…
          </button>
          <button class="wv-btn wv-btn--sm" id="cfg-validate" title="Validate the document">
            <i class="codicon codicon-debug-start"></i> Validate
          </button>
          <button class="wv-btn wv-btn--sm" id="cfg-reset" title="Reset to defaults">
            <i class="codicon codicon-discard"></i> Reset
          </button>
          <button class="wv-btn wv-btn--sm" id="cfg-open-file" title="Open the on-disk config file">
            <i class="codicon codicon-json"></i> Open as file
          </button>
          <span class="wv-config-status" id="cfg-status" aria-live="polite"></span>
        </div>
        <div class="wv-config-grid">
          <div class="wv-config-editor" id="cfg-editor"></div>
          <div class="wv-config-preview">
            <header class="wv-config-preview-head">
              <i class="codicon codicon-pulse"></i> Live preview
              <span class="wv-config-preview-sub">evaluated against the current snapshot</span>
            </header>
            <div id="cfg-preview"></div>
          </div>
        </div>
      </div>
    </details>`;

  installMonacoProviders();

  const editorEl = el.querySelector<HTMLElement>('#cfg-editor')!;
  const previewEl = el.querySelector<HTMLElement>('#cfg-preview')!;
  const statusEl = el.querySelector<HTMLElement>('#cfg-status')!;

  const editor = monaco.editor.create(editorEl, {
    value: DEFAULT_DOC,
    language: 'json',
    theme: 'vs-dark',
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 12,
    tabSize: 2,
    wordWrap: 'on',
    scrollBeyondLastLine: false,
  });

  // Lazy import the live snapshot hookup from the main webview bundle.
  let liveSnapshot: import('../../src/domain/types').UsageSnapshot | null = null;
  let lastDoc: unknown = null;

  // Listen for snapshot updates the parent has stashed on `window.__wvSnapshot`.
  const snapObserver = new MutationObserver(() => {
    const s = (
      window as unknown as { __wvSnapshot?: import('../../src/domain/types').UsageSnapshot }
    ).__wvSnapshot;
    if (s !== liveSnapshot) {
      liveSnapshot = s ?? null;
      refreshPreview();
    }
  });
  snapObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

  const persist = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    statusEl.textContent = '';
    debounceTimer = setTimeout(() => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(editor.getValue());
      } catch (e) {
        statusEl.innerHTML = `<i class="codicon codicon-error"></i> ${escape(
          e instanceof Error ? e.message : 'parse error',
        )}`;
        return;
      }
      const errors: { ruleId: string; field: string; message: string }[] = [];
      const rules = Array.isArray((parsed as { rules?: unknown[] }).rules)
        ? (
            parsed as {
              rules: {
                id: string;
                when?: string;
                active?: string;
                derived?: Record<string, string>;
              }[];
            }
          ).rules
        : [];
      for (const r of rules) {
        for (const f of ['when', 'active'] as const) {
          if (typeof r[f] === 'string') {
            const res = checkExpression(r[f]!);
            if (!res.ok) errors.push({ ruleId: r.id, field: f, message: res.error });
          }
        }
        if (r.derived) {
          for (const [k, src] of Object.entries(r.derived)) {
            const res = checkExpression(src);
            if (!res.ok) errors.push({ ruleId: r.id, field: `derived.${k}`, message: res.error });
          }
        }
      }
      if (errors.length > 0) {
        statusEl.innerHTML = `<i class="codicon codicon-warning"></i> ${errors.length} expression error(s)`;
        refreshPreview({ overrideErrors: errors });
        return;
      }
      lastDoc = parsed;
      post({ type: 'setConfig', value: parsed as Partial<UserConfig> });
      statusEl.innerHTML = `<i class="codicon codicon-check"></i> saved`;
    }, 250);
  };

  editor.onDidChangeModelContent(persist);

  el.querySelector('#cfg-templates')!.addEventListener('click', () => {
    const snippets = getTemplateSnippets();
    const list = document.createElement('div');
    list.className = 'wv-quickpick';
    for (const t of snippets) {
      const btn = document.createElement('button');
      btn.className = 'wv-quickpick-item';
      btn.innerHTML = `<i class="codicon codicon-zap"></i> <strong>${escape(t.label)}</strong> <span>${escape(
        t.detail,
      )}</span>`;
      btn.addEventListener('click', () => {
        const sel = editor.getSelection();
        if (sel) editor.executeEdits('template', [{ range: sel, text: t.insertText }]);
        list.remove();
      });
      list.appendChild(btn);
    }
    document.body.appendChild(list);
    setTimeout(() => list.remove(), 8000);
  });

  el.querySelector('#cfg-vars')!.addEventListener('click', () => {
    const sel = editor.getSelection();
    const text = sel ? editor.getModel()!.getValueInRange(sel) : '';
    if (text) {
      const wrapped = `{{${text}}}`;
      editor.executeEdits('vars', [{ range: sel!, text: wrapped }]);
    }
  });

  el.querySelector('#cfg-validate')!.addEventListener('click', () => {
    try {
      JSON.parse(editor.getValue());
      statusEl.innerHTML = `<i class="codicon codicon-check"></i> JSON is valid`;
    } catch (e) {
      statusEl.innerHTML = `<i class="codicon codicon-error"></i> ${escape(
        e instanceof Error ? e.message : 'parse error',
      )}`;
    }
  });

  el.querySelector('#cfg-reset')!.addEventListener('click', () => {
    editor.setValue(DEFAULT_DOC);
  });

  el.querySelector('#cfg-open-file')!.addEventListener('click', () => {
    post({ type: 'openConfig' });
  });

  function refreshPreview(opts?: {
    overrideErrors?: { ruleId: string; field: string; message: string }[];
  }) {
    const doc = lastDoc;
    const rules = (
      doc && typeof doc === 'object' && Array.isArray((doc as { rules?: unknown[] }).rules)
        ? (doc as { rules: import('../../src/domain/types').AlertRule[] }).rules
        : []
    ) as import('../../src/domain/types').AlertRule[];
    const groups = (
      doc && typeof doc === 'object' && Array.isArray((doc as { groups?: unknown[] }).groups)
        ? (doc as { groups: import('../../src/domain/types').AlertGroup[] }).groups
        : []
    ) as import('../../src/domain/types').AlertGroup[];
    const vars =
      (doc && typeof doc === 'object' && (doc as { vars?: Record<string, unknown> }).vars) || {};

    const errors = opts?.overrideErrors ?? [];
    if (!liveSnapshot || rules.length === 0) {
      previewEl.innerHTML = renderPreview({ rows: [], errors });
      return;
    }
    const fired = evaluateAlertRules({
      snapshot: liveSnapshot,
      rules,
      groups,
      ...(vars !== undefined
        ? { vars: vars as Record<string, import('../../src/domain/expr/ast').Value> }
        : {}),
      signedIn: !!liveSnapshot.githubBilling,
      fired: new Map(),
      now: Date.now(),
    });
    const firedIds = new Set(fired.map((f) => `${f.ruleId}#${f.severity}`));
    const rows: PreviewRow[] = rules.map((r) => {
      const key = `${r.id}#${r.severity}`;
      const isFired = firedIds.has(key);
      let message = r.message;
      try {
        const firedEntry = fired.find((f) => `${f.ruleId}#${f.severity}` === key);
        message = firedEntry?.message ?? r.message;
      } catch {
        /* fall back to template */
      }
      return {
        ruleId: r.id,
        severity: r.severity,
        fired: isFired,
        message,
        active: true,
        cooldownLeft: 0,
      };
    });
    previewEl.innerHTML = renderPreview({ rows, errors });
  }

  return {
    update(config: UserConfig) {
      const doc = {
        version: 2 as const,
        ...(config.vars !== undefined ? { vars: config.vars } : {}),
        ...(config.budget !== undefined ? { budget: config.budget } : {}),
        ...(config.groups !== undefined ? { groups: config.groups } : {}),
        ...(config.rules !== undefined ? { rules: config.rules } : {}),
      };
      const json = JSON.stringify(doc, null, 2);
      // Only overwrite if different (avoid clobbering in-progress edits)
      if (
        editor.getValue().trim() === '' ||
        (lastDoc && JSON.stringify(lastDoc) !== json && !editor.getValue().includes('__wv_dirty__'))
      ) {
        editor.setValue(json);
        lastDoc = doc;
      }
      refreshPreview();
    },
  };
}
