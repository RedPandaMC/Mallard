/**
 * Calibration source backed by GitHub. Intentionally a STUB this pass: there is
 * no stable public per-user Copilot billing endpoint, so it always reports
 * `unavailable`. The auth plumbing and the `authoritative` calibration hook are
 * fully wired so a real endpoint becomes a drop-in later.
 */
import { ProviderStatus, SourceKind } from '../../model/types';
import { ProviderContext, ProviderResult, UsageProvider } from '../UsageProvider';

export class GitHubBillingProvider implements UsageProvider {
  readonly kind: SourceKind = 'github';

  constructor(private readonly getToken: () => Promise<string | undefined>) {}

  async probe(): Promise<ProviderStatus> {
    const token = await this.getToken();
    return token
      ? { kind: 'degraded', reason: 'Connected (using local estimate)' }
      : { kind: 'unavailable', reason: 'Not signed in' };
  }

  async fetch(
    _range: { start: number; end: number },
    _ctx: ProviderContext,
  ): Promise<ProviderResult> {
    const token = await this.getToken();
    if (!token) {
      return { events: [], status: { kind: 'unavailable', reason: 'Not signed in' } };
    }
    // Org-managed seats and the absence of a public per-user billing API both
    // land here: keep the local estimate, surface a clear reason, never throw.
    return {
      events: [],
      status: { kind: 'unavailable', reason: 'Connected — official billing not yet available' },
    };
  }
}
