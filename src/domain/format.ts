/* c8 ignore next */
/**
 * Shared, locale-aware formatters used by both the host and the webview.
 * Pure — no `vscode`, no DOM.
 */
import { Metric } from './types';

export function formatMoney(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(Math.round(n));
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function formatCredits(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString();
}

/* c8 ignore next */
export function formatMetric(value: number, metric: Metric, currency = 'USD'): string {
  switch (metric) {
    case 'cost':
      return formatMoney(value, currency);
    case 'credits':
      return `${formatCredits(value)} cr`;
    case 'tokens':
      return `${formatTokens(value)} tok`;
    default: {
      const _exhaustive: never = metric;
      throw new Error(`Unknown metric: ${_exhaustive}`);
    }
  }
}
