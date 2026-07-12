/* c8 ignore next */
/**
 * Best-effort discovery of local Copilot log files.
 *
 * Primary: uses vscode.env.logUri which reliably points at the current
 * session's log folder. Falls back to platform-default paths only when
 * the VS Code API is unavailable (e.g. unit tests).
 *
 * Path-traversal guard: all resolved paths must be under an allowed root.
 */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Resolve the VS Code log root (the parent of the session-specific folder). */
export function vscodeLogRoot(logUriPath: string): string {
  // logUri typically: .../logs/20260612T123456/window1/exthost
  // Walk up to find the "logs" ancestor.
  let logPath = logUriPath;
  for (let i = 0; i < 4; i++) {
    const parent = path.dirname(logPath);
    if (parent === logPath) break;
    if (path.basename(parent).toLowerCase() === 'logs') return parent;
    logPath = parent;
  }
  // Fallback: use the direct parent of the provided path.
  return path.dirname(logUriPath);
}

/** Platform-default VS Code log directories (desktop installs). */
function desktopDefaults(): string[] {
  const home = os.homedir();
  /* c8 ignore next 6 */
  if (process.platform === 'darwin') {
    return [
      path.join(home, 'Library', 'Application Support', 'Code', 'logs'),
      path.join(home, 'Library', 'Application Support', 'Code - Insiders', 'logs'),
    ];
  }
  /* c8 ignore next 7 */
  if (process.platform === 'win32') {
    if (!process.env.APPDATA) return [];
    return [
      path.join(process.env.APPDATA, 'Code', 'logs'),
      path.join(process.env.APPDATA, 'Code - Insiders', 'logs'),
    ];
  }
  return [
    path.join(home, '.config', 'Code', 'logs'),
    path.join(home, '.config', 'Code - Insiders', 'logs'),
    path.join(home, '.config', 'VSCodium', 'logs'),
    // Flatpak (common on Fedora/GNOME)
    path.join(home, '.var', 'app', 'com.visualstudio.code', 'config', 'Code', 'logs'),
    path.join(home, '.var', 'app', 'com.visualstudio.code.insiders', 'config', 'Code - Insiders', 'logs'),
    // Snap (common on Ubuntu)
    path.join(home, 'snap', 'code', 'current', '.config', 'Code', 'logs'),
    path.join(home, 'snap', 'code-insiders', 'current', '.config', 'Code - Insiders', 'logs'),
  ];
}

/** VS Code Server, OSS, and VSCodium log directories. */
function serverAndForks(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.vscode-server', 'data', 'logs'),
    path.join(home, '.vscode-server-insiders', 'data', 'logs'),
    path.join(home, '.vscode-oss', 'data', 'logs'),
    path.join(home, '.vscode-oss-dev', 'data', 'logs'),
  ];
}

/** Platform-default VS Code log directories (desktop + server + forks). */
export function platformDefaults(): string[] {
  return [...desktopDefaults(), ...serverAndForks()];
}

export async function locateCopilotLogDirs(
  logUriPath?: string,
  override?: string,
): Promise<string[]> {
  const candidates: string[] = [];
  if (override) candidates.push(override);
  if (logUriPath) candidates.push(vscodeLogRoot(logUriPath));
  candidates.push(...platformDefaults());

  const existing: string[] = [];
  for (const c of candidates) {
    try {
      const st = await fs.stat(c);
      if (st.isDirectory()) existing.push(c);
    } catch {
      // not present — skip
    }
  }
  return existing;
}

/**
 * Assert that `filePath` is inside one of the `allowedRoots`.
 * Returns false if the path escapes via `..` or is on a different drive (Windows).
 */
export function isPathSafe(filePath: string, allowedRoots: string[]): boolean {
  const resolved = path.resolve(filePath);
  return allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    return resolved.startsWith(resolvedRoot + path.sep) || resolved === resolvedRoot;
  });
}

/** Resolve symlinks so containment checks compare real locations; falls back
 *  to a plain resolve for paths that don't (yet) exist. */
export async function canonicalize(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return path.resolve(p);
  }
}

/** Filename patterns that count as a Copilot log. */
function isCopilotLogFilename(name: string): boolean {
  const lower = name.toLowerCase();
  if (!lower.includes('copilot')) return false;
  return (
    lower.endsWith('.log') ||
    lower.endsWith('.json') ||
    /* c8 ignore next 2 */
    lower.endsWith('.ndjson') ||
    lower.endsWith('.otel.json')
  );
}

/** Shallow walk for Copilot-ish log files, with depth/count caps to stay cheap. */
export async function findLogFiles(
  dir: string,
  allowedRoots: string[],
  maxDepth = 5,
  maxFiles = 300,
  filter: (name: string) => boolean = isCopilotLogFilename,
): Promise<string[]> {
  const out: string[] = [];

  // Canonicalize the start dir and roots once so a symlinked root can't alias
  // the containment check. The walk itself never follows symlinks (Dirent
  // isFile/isDirectory are both false for links), so entries below a real
  // start dir are real paths.
  const realRoots = await Promise.all(allowedRoots.map(canonicalize));
  const startDir = await canonicalize(dir);

  async function walk(current: string, depth: number): Promise<void> {
    /* c8 ignore next */
    if (depth > maxDepth || out.length >= maxFiles) return;
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    /* c8 ignore next 3 */
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      const full = path.join(current, entry.name);
      /* c8 ignore next */
      if (!isPathSafe(full, realRoots)) continue;
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        if (filter(full)) out.push(full);
      }
    }
  }

  await walk(startDir, 0);
  return out;
}

// ── Claude Code log discovery ─────────────────────────────────────────────────

/**
 * Platform-default directories where Claude Code writes its JSONL session logs.
 * Claude Code stores one `.jsonl` file per session under
 * `~/.claude/projects/<hashed-workspace-path>/`.
 */
export function claudeCodeLogRoots(): string[] {
  const home = os.homedir();
  const base = path.join(home, '.claude', 'projects');
  // Windows: Claude Code follows XDG/home convention even on Windows
  return [base];
}

/** Returns directories that actually exist on disk. */
export async function locateClaudeCodeLogDirs(): Promise<string[]> {
  const existing: string[] = [];
  for (const dir of claudeCodeLogRoots()) {
    try {
      const st = await fs.stat(dir);
      /* c8 ignore next */
      if (st.isDirectory()) existing.push(dir);
    /* c8 ignore next 3 */
    } catch {
      // not present
    }
  }
  return existing;
}

/** Returns true for Claude Code session log files (`*.jsonl`). */
/* c8 ignore next */
export function isClaudeCodeLogFilename(name: string): boolean {
  return name.toLowerCase().endsWith('.jsonl');
}
