import * as vscode from 'vscode';

export interface InstalledExtension {
  id: string;
  version: string;
  isActive: boolean;
}

export interface ExtensionProbe {
  /** Human-readable name for diagnostics. */
  name: string;
  /** Candidate extension IDs tried in order; first match wins. */
  ids: readonly string[];
}

/**
 * Built-in probes for known AI coding extensions.
 * Push additional probes here to detect new tools without modifying callers.
 */
export const EXTENSION_PROBES: ExtensionProbe[] = [
  { name: 'GitHub Copilot', ids: ['github.copilot', 'github.copilot-chat'] },
  { name: 'Claude Code',    ids: ['anthropic.claude-code'] },
];

/** Check whether any of a probe's candidate extensions are installed. */
export function probeExtension(probe: ExtensionProbe): InstalledExtension | undefined {
  for (const id of probe.ids) {
    const ext = vscode.extensions.getExtension(id);
    if (ext) {
      return { id, version: ext.packageJSON.version as string, isActive: ext.isActive };
    }
  }
  return undefined;
}

export function detectCopilot(): InstalledExtension | undefined {
  return probeExtension(EXTENSION_PROBES[0]!);
}

export function detectClaudeCode(): InstalledExtension | undefined {
  return probeExtension(EXTENSION_PROBES[1]!);
}

/** Detect all known extensions in one pass — for diagnostics output. */
export function detectAll(): Array<{ name: string; result: InstalledExtension | undefined }> {
  return EXTENSION_PROBES.map((p) => ({ name: p.name, result: probeExtension(p) }));
}
