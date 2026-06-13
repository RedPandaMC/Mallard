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
export function vscodLogRoot(logUriPath: string): string {
  // logUri typically: .../logs/20260612T123456/window1/exthost
  // Walk up to find the "logs" ancestor.
  let p = logUriPath;
  for (let i = 0; i < 4; i++) {
    const parent = path.dirname(p);
    if (parent === p) break;
    if (path.basename(parent).toLowerCase() === 'logs') return parent;
    p = parent;
  }
  // Fallback: use the direct parent of the provided path.
  return path.dirname(logUriPath);
}

/** Platform-default VS Code log directories. */
function platformDefaults(): string[] {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return [path.join(home, 'Library', 'Application Support', 'Code', 'logs')];
  }
  if (process.platform === 'win32') {
    return process.env.APPDATA ? [path.join(process.env.APPDATA, 'Code', 'logs')] : [];
  }
  return [path.join(home, '.config', 'Code', 'logs')];
}

export async function locateCopilotLogDirs(
  logUriPath?: string,
  override?: string,
): Promise<string[]> {
  const candidates: string[] = [];
  if (override) candidates.push(override);
  if (logUriPath) candidates.push(vscodLogRoot(logUriPath));
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
  if (resolved.includes('..')) return false;
  return allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    return resolved.startsWith(resolvedRoot + path.sep) || resolved === resolvedRoot;
  });
}

/** Shallow walk for Copilot-ish log files, with depth/count caps to stay cheap. */
export async function findLogFiles(
  dir: string,
  allowedRoots: string[],
  maxDepth = 5,
  maxFiles = 300,
): Promise<string[]> {
  const out: string[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth || out.length >= maxFiles) return;
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      const full = path.join(current, entry.name);
      if (!isPathSafe(full, allowedRoots)) continue;
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        const lower = full.toLowerCase();
        if (lower.includes('copilot') && (lower.endsWith('.log') || lower.endsWith('.json'))) {
          out.push(full);
        }
      }
    }
  }

  await walk(dir, 0);
  return out;
}
