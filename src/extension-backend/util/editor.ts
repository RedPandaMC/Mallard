/**
 * Active-editor language detection. Like repo/branch attribution in
 * util/repo.ts, this is a parse-time heuristic: the language of whatever
 * editor is focused when a batch of log lines is ingested. Connectors apply
 * it only to live rows (see ParseContext.liveThresholdMs) so backfilled
 * history is never blamed on the currently open file's language.
 */
import * as vscode from 'vscode';

/** VS Code languageId of the active editor, or undefined when none is open. */
export function activeLanguage(): string | undefined {
  return vscode.window.activeTextEditor?.document.languageId;
}
