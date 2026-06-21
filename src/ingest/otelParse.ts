import { PricingManifest } from '../domain/pricing';

export interface ParseContext {
  pricePerCredit: number;
  manifest?: PricingManifest;
  now: number;
  /** Repo to attribute these events to (active workspace repo at parse time). */
  repo?: string;
  /** Git branch active at parse time. */
  branch?: string;
  /** Stable per-file key so ids are unique across log files. */
  fileKey?: string;
  /**
   * Absolute character offset where `content` begins in the source file. With a
   * per-line offset this yields ids that are stable whether the file is parsed
   * in full or incrementally, so re-parsing never duplicates or drops events.
   */
  baseOffset?: number;
}
