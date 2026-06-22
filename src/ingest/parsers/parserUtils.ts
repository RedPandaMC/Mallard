/* c8 ignore start */
import { CostCategory, Surface } from '../../domain/types';
/* c8 ignore stop */

/** Coerce an unknown value to a non-negative finite number, or return undefined. */
export function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : undefined;
  return n != null && !Number.isNaN(n) && n >= 0 ? n : undefined;
}

/** Stable 8-char base-36 hash of a file path (djb2), used to namespace event IDs. */
export function fileKeyOf(filePath: string): string {
  let hash = 5381;
  for (let i = 0; i < filePath.length; i++) hash = ((hash << 5) + hash + filePath.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export interface TokenCounts {
  prompt?: number;
  completion?: number;
  cacheCreation?: number;
  cacheRead?: number;
  thinking?: number;
}

/**
 * Distribute a total cost across token categories using proportional token weights.
 * Returns a partial record keyed by CostCategory.
 */
export function splitCost(cost: number, tokens: TokenCounts): Partial<Record<CostCategory, number>> {
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

/** Map a raw surface string to the canonical Surface value. */
/* c8 ignore next */
export function toSurface(v: unknown): Surface {
  const s = String(v ?? '').toLowerCase();
  if (s.includes('inline') || s.includes('completion')) return 'inline';
  if (s.includes('agent')) return 'agent';
  if (s.includes('edit')) return 'edit';
  if (s.includes('chat')) return 'chat';
  return 'unknown';
}
