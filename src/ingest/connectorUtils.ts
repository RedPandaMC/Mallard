import type { CostCategory, Surface } from '../domain/types';

export type AnyRecord = Record<string, unknown>;

export interface TokenBreakdown {
  prompt?: number;
  completion?: number;
  cacheCreation?: number;
  cacheRead?: number;
  thinking?: number;
}

export function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : undefined;
  return n != null && !Number.isNaN(n) && n >= 0 ? n : undefined;
}

export function pick(attrs: AnyRecord, keys: string[]): unknown {
  for (const k of keys) {
    if (attrs[k] != null) return attrs[k];
  }
  return undefined;
}

export function toSurface(v: unknown): Surface {
  const s = String(v ?? '').toLowerCase();
  if (s.includes('inline') || s.includes('completion')) return 'inline';
  if (s.includes('agent')) return 'agent';
  if (s.includes('edit')) return 'edit';
  if (s.includes('chat')) return 'chat';
  return 'unknown';
}

/** djb2 hash — stable short key for a file path, used to namespace event ids. */
export function fileKeyOf(filePath: string): string {
  let hash = 5381;
  for (let i = 0; i < filePath.length; i++) hash = ((hash << 5) + hash + filePath.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/** Parse an event timestamp from a raw row, falling back to `fallback` (epoch ms). */
export function parseTimestamp(row: AnyRecord, fallback: number): number {
  const raw = row['timestamp'] ?? row['time'];
  const ts =
    typeof raw === 'string' ? Date.parse(raw) :
    typeof raw === 'number' ? raw :
    NaN;
  return Number.isNaN(ts) ? fallback : ts;
}

/**
 * Split a 2-category cost proportionally between input and output tokens.
 * Used by CopilotConnector where only prompt + completion are available.
 */
export function splitCostSimple(
  cost: number,
  promptTokens: number,
  totalTokens: number,
): Partial<Record<CostCategory, number>> {
  if (totalTokens === 0) return {};
  const out: Partial<Record<CostCategory, number>> = {};
  const inputCost = (cost * promptTokens) / totalTokens;
  if (inputCost > 0) out.input = inputCost;
  const outputCost = cost - inputCost;
  if (outputCost > 0) out.output = outputCost;
  return out;
}

/**
 * Split a cost across all available token categories proportionally.
 * Used by ClaudeCodeConnector where cache and thinking tokens are available.
 */
export function splitCostByBreakdown(
  cost: number,
  tokens: TokenBreakdown,
): Partial<Record<CostCategory, number>> {
  const total =
    (tokens.prompt ?? 0) +
    (tokens.completion ?? 0) +
    (tokens.cacheCreation ?? 0) +
    (tokens.cacheRead ?? 0) +
    (tokens.thinking ?? 0);
  if (total === 0) return {};
  const out: Partial<Record<CostCategory, number>> = {};
  if (tokens.prompt)        out.input          = (cost * tokens.prompt)        / total;
  if (tokens.completion)    out.output         = (cost * tokens.completion)    / total;
  if (tokens.cacheCreation) out.cache_creation = (cost * tokens.cacheCreation) / total;
  if (tokens.cacheRead)     out.cache_read     = (cost * tokens.cacheRead)     / total;
  if (tokens.thinking)      out.thinking       = (cost * tokens.thinking)      / total;
  return out;
}
