import * as path from 'path';
import { FolderLike, LogParser } from '../LogParser';
import { ParseContext, parseClaudeCodeContent } from '../otelParse';
import { SourceKind, UsageEvent } from '../../domain/types';

/**
 * Resolves a Claude Code project folder path segment to a workspace folder by
 * reverse-mapping the hash Claude Code uses for workspace paths.
 *
 * Claude Code stores sessions at ~/.claude/projects/<H>/session.jsonl where
 * <H> = encodeURIComponent(fsPath).replace(/%/g, '').toLowerCase()
 */
function matchFolderHash(projectHash: string, folders: ReadonlyArray<FolderLike>): FolderLike | undefined {
  return folders.find((wf) => {
    const hash = encodeURIComponent(wf.uri.fsPath).replace(/%/g, '').toLowerCase();
    return hash === projectHash;
  });
}

export class ClaudeCodeParser implements LogParser {
  readonly sourceKind: SourceKind = 'claude-code';

  /**
   * Injected provider for the list of open workspace folders.
   * Defaults to () => undefined so the class is constructable without the
   * VS Code runtime (unit tests, etc.). Pass () => vscode.workspace.workspaceFolders
   * at activation time.
   */
  private readonly getFolders: () => ReadonlyArray<FolderLike> | undefined;

  constructor(getFolders?: () => ReadonlyArray<FolderLike> | undefined) {
    this.getFolders = getFolders ?? (() => undefined);
  }

  canParse(filePath: string): boolean {
    return (
      path.basename(filePath).toLowerCase().endsWith('.jsonl') &&
      filePath.includes('.claude')
    );
  }

  resolveWorkspace(filePath: string): FolderLike | undefined {
    // filePath: /home/user/.claude/projects/<H>/session.jsonl
    const parts = filePath.split(path.sep);
    const projIdx = parts.findIndex((p) => p === 'projects') + 1;
    if (projIdx === 0 || projIdx >= parts.length) return undefined;
    const projectHash = parts[projIdx]!.toLowerCase();

    const folders = this.getFolders();
    if (!folders) return undefined;
    return matchFolderHash(projectHash, folders);
  }

  parse(content: string, ctx: ParseContext): UsageEvent[] {
    return parseClaudeCodeContent(content, ctx);
  }
}
