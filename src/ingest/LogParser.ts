import { SourceKind, UsageEvent } from '../domain/types';
import { ParseContext } from './otelParse';

/** Minimal workspace folder shape needed for attribution — avoids a hard vscode dependency. */
export interface FolderLike {
  uri: { fsPath: string };
  name: string;
  index: number;
}

export interface LogParser {
  /** Declared source kind — no instanceof checks needed for routing decisions. */
  readonly sourceKind: SourceKind;

  /** True when this parser should handle the given absolute file path. */
  canParse(filePath: string): boolean;

  /**
   * Resolve which workspace folder this file's events belong to.
   * Returns undefined for user-level logs with no workspace affinity.
   */
  resolveWorkspace(filePath: string): FolderLike | undefined;

  /** Parse the file content slice into UsageEvents. */
  parse(content: string, ctx: ParseContext): UsageEvent[];
}
