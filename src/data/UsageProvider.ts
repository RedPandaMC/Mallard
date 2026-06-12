import { ProviderStatus, SourceKind, UsageEvent } from '../model/types';

export interface ProviderContext {
  pricePerCredit: number;
  currency: string;
  modelMultipliers?: Record<string, number>;
  copilotLogPath?: string;
  now: number;
}

export interface ProviderResult {
  events: UsageEvent[];
  status: ProviderStatus;
  /** Authoritative period total (e.g. from GitHub billing) used to calibrate estimates. */
  authoritative?: {
    periodStart: number;
    periodEnd: number;
    credits: number;
    cost: number;
  };
}

/**
 * A capture source. `fetch` MUST resolve (never reject) — return an
 * `unavailable` status instead so the pipeline degrades gracefully.
 */
export interface UsageProvider {
  readonly kind: SourceKind;
  probe(ctx: ProviderContext): Promise<ProviderStatus>;
  fetch(range: { start: number; end: number }, ctx: ProviderContext): Promise<ProviderResult>;
}
