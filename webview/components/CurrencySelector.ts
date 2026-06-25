export interface CurrencySelectorHandle {
  update(fxRates: Record<string, number>, selected: string): void;
}

export function mountCurrencySelector(
  el: HTMLElement,
  onChange: (code: string) => void,
): CurrencySelectorHandle {
  el.innerHTML = `
    <label class="wv-currency-label" for="currency-select" aria-label="Display currency">
      <i class="codicon codicon-symbol-unit"></i>
    </label>
    <select class="wv-currency-select" id="currency-select" aria-label="Select display currency"></select>`;

  const select = el.querySelector<HTMLSelectElement>('#currency-select')!;
  select.addEventListener('change', () => onChange(select.value));

  return {
    update(fxRates: Record<string, number>, selected: string) {
      const codes = Object.keys(fxRates).sort();
      const current = select.value;
      // Only rebuild options when the currency list changes.
      const newList = codes.join(',');
      if ((select as HTMLSelectElement & { _list?: string })._list === newList) {
        // Just sync selection.
        if (select.value !== selected) select.value = selected;
        return;
      }
      (select as HTMLSelectElement & { _list?: string })._list = newList;
      select.innerHTML = codes
        .map((c) => `<option value="${c}"${c === selected ? ' selected' : ''}>${c}</option>`)
        .join('');
      if (current && codes.includes(current)) select.value = current;
    },
  };
}
