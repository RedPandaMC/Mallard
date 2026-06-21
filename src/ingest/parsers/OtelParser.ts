import * as path from 'path';
import { FolderLike, LogParser } from '../LogParser';
import { ParseContext, parseOtelContent } from '../otelParse';
import { SourceKind, UsageEvent } from '../../domain/types';

export class OtelParser implements LogParser {
  readonly sourceKind: SourceKind = 'local';

  canParse(filePath: string): boolean {
    const name = path.basename(filePath).toLowerCase();
    return (
      name.includes('copilot') &&
      (name.endsWith('.log') ||
        name.endsWith('.json') ||
        name.endsWith('.ndjson') ||
        name.endsWith('.otel.json'))
    );
  }

  // OTel log root is the global VS Code log directory — user-level, not per-workspace.
  // Attribution comes from the active editor at parse time (handled by LogWatcher).
  resolveWorkspace(_filePath: string): FolderLike | undefined {
    return undefined;
  }

  parse(content: string, ctx: ParseContext): UsageEvent[] {
    return parseOtelContent(content, ctx);
  }
}
