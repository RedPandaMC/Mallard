/**
 * Collapsible suggestions panel — shown after 14+ days of data.
 * Highlights models that could be swapped for cheaper alternatives.
 */
import { ModelSuggestion, UsageSnapshot } from '../../src/model/types';
import { formatMoney } from '../../src/model/format';

export interface SuggestionsPanelHandle {
  update(snapshot: UsageSnapshot): void;
}

function renderSuggestion(s: ModelSuggestion, currency: string): string {
  return `
    <div class="wv-suggestion">
      <div class="wv-suggestion-header">
        <span class="wv-suggestion-model">${escHtml(s.currentModel)}</span>
        <i class="codicon codicon-arrow-right"></i>
        <span class="wv-suggestion-alt">${escHtml(s.suggestedModel)}</span>
        <span class="wv-suggestion-surface">(${escHtml(s.surface)})</span>
        <span class="wv-suggestion-saving">
          Save ~${escHtml(formatMoney(s.estimatedMonthlySaving, currency))}/mo
        </span>
      </div>
      <div class="wv-suggestion-basis">${escHtml(s.basis)}</div>
    </div>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function mountSuggestionsPanel(el: HTMLElement): SuggestionsPanelHandle {
  return {
    update(s: UsageSnapshot) {
      if (s.suggestions.length === 0) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      const currency = s.currency;

      el.innerHTML = `
        <details class="wv-suggestions">
          <summary class="wv-suggestions-summary">
            <i class="codicon codicon-lightbulb"></i>
            Suggestions (${s.suggestions.length})
          </summary>
          <div class="wv-suggestions-body">
            ${s.suggestions.map((sg) => renderSuggestion(sg, currency)).join('')}
          </div>
        </details>`;
    },
  };
}
