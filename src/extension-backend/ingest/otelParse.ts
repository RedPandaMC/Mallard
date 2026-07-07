import { PricingManifest, TokenPrices } from '../domain/pricing';
import type { Surface } from '../domain/types';

export interface ParseContext {
  pricePerCredit: number;
  manifest?: PricingManifest;
  /** Per-token USD prices from the daily feed; absent before the first fetch. */
  tokenPrices?: TokenPrices;
  now: number;
  /** Repo to attribute these events to (active workspace repo at parse time). */
  repo?: string;
  /** Git branch active at parse time. */
  branch?: string;
  /**
   * Events with ts at or after this are "live" and may take the heuristic
   * repo/branch above. Absent on a first/backfill pass (no prior watermark) —
   * then nothing is live and heuristic attribution is skipped entirely,
   * because a backfilled row's usage happened before the current editor
   * state existed. See BaseFileConnector.buildContext for the rule.
   */
  liveThresholdMs?: number;
  /** Stable per-file key so ids are unique across log files. */
  fileKey?: string;
  /**
   * Absolute character offset where `content` begins in the source file. With a
   * per-line offset this yields ids that are stable whether the file is parsed
   * in full or incrementally, so re-parsing never duplicates or drops events.
   */
  baseOffset?: number;
  /** Pre-detected surface hint (e.g. from a glob-level agent-mode pre-scan). */
  surface?: Surface;
}
