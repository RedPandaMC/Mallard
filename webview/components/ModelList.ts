import { TopEntry, UsageSnapshot } from '../../src/domain/types';
import { formatCredits, formatMoney, formatTokens } from '../../src/domain/format';

export interface ModelListHandle {
  update(snapshot: UsageSnapshot, selectedCurrency: string): void;
}

function shortModelName(key: string): string {
  return key.replace(/^(models\/|openai\/|anthropic\/|google\/|meta\/|mistral\/)/, '');
}

function convertCost(usdCost: number, fxRates: Record<string, number>, code: string): number {
  const rate = fxRates[code] ?? 1;
  return usdCost * rate;
}

export function mountModelList(el: HTMLElement): ModelListHandle {
  el.innerHTML = `
    <div class="wv-model-list-header">
      <span class="wv-model-list-title"><i class="codicon codicon-symbol-method"></i> Models</span>
    </div>
    <div class="wv-model-list-rows" id="model-list-rows" role="list"></div>`;

  const rowsEl = el.querySelector<HTMLElement>('#model-list-rows')!;

  return {
    update(snapshot: UsageSnapshot, selectedCurrency: string) {
      const { topModels, fxRates } = snapshot;
      if (!topModels.length) {
        rowsEl.innerHTML = '<div class="wv-model-list-empty">No model data yet</div>';
        return;
      }

      const currencyCode = fxRates[selectedCurrency] !== undefined ? selectedCurrency : 'USD';
      const maxCredits = Math.max(...topModels.map((m) => m.credits), 1);

      rowsEl.innerHTML = topModels
        .slice(0, 10)
        .map((m: TopEntry, i: number) => {
          const bar = Math.round((m.credits / maxCredits) * 100);
          const cost = convertCost(m.cost, fxRates, currencyCode);
          return `
          <div class="wv-model-row" role="listitem" title="${m.key}">
            <div class="wv-model-row-rank">${i + 1}</div>
            <div class="wv-model-row-info">
              <div class="wv-model-row-name">${shortModelName(m.key)}</div>
              <div class="wv-model-row-bar-wrap">
                <div class="wv-model-row-bar" style="width:${bar}%"></div>
              </div>
            </div>
            <div class="wv-model-row-stats">
              <span class="wv-model-stat wv-model-stat--credits">${formatCredits(m.credits)} cr</span>
              <span class="wv-model-stat wv-model-stat--tokens">${formatTokens(m.tokens)}</span>
              <span class="wv-model-stat wv-model-stat--cost">${formatMoney(cost, currencyCode)}</span>
            </div>
          </div>`;
        })
        .join('');
    },
  };
}
