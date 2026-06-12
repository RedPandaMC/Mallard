/**
 * Best-effort estimate from Copilot's local logs. Always resolves; returns an
 * `unavailable` status when nothing usable is found so the pipeline can fall
 * back to sample data.
 */
import { promises as fs } from 'fs';
import { ProviderStatus, SourceKind, UsageEvent } from '../../model/types';
import { ProviderContext, ProviderResult, UsageProvider } from '../UsageProvider';
import { findLogFiles, locateCopilotLogDirs } from './logparse/locate';
import { parseOtelContent } from './logparse/otelParse';

export class LocalLogProvider implements UsageProvider {
  readonly kind: SourceKind = 'local';

  async probe(ctx: ProviderContext): Promise<ProviderStatus> {
    const dirs = await locateCopilotLogDirs(ctx.copilotLogPath || undefined);
    return dirs.length
      ? { kind: 'degraded', reason: 'Estimated from local Copilot logs' }
      : { kind: 'unavailable', reason: 'No Copilot logs found' };
  }

  async fetch(
    range: { start: number; end: number },
    ctx: ProviderContext,
  ): Promise<ProviderResult> {
    try {
      const dirs = await locateCopilotLogDirs(ctx.copilotLogPath || undefined);
      if (dirs.length === 0) {
        return { events: [], status: { kind: 'unavailable', reason: 'No Copilot logs found' } };
      }

      const events: UsageEvent[] = [];
      for (const dir of dirs) {
        const files = await findLogFiles(dir);
        for (const file of files) {
          try {
            const content = await fs.readFile(file, 'utf8');
            events.push(...parseOtelContent(content, ctx));
          } catch {
            // unreadable file — skip
          }
        }
      }

      const inRange = events.filter((e) => e.ts >= range.start && e.ts < range.end);
      return {
        events: inRange,
        status: inRange.length
          ? { kind: 'degraded', reason: 'Estimated from local Copilot logs' }
          : { kind: 'unavailable', reason: 'No usage found in local logs' },
      };
    } catch {
      return { events: [], status: { kind: 'unavailable', reason: 'Could not read local logs' } };
    }
  }
}
