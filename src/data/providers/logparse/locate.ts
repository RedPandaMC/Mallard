/**
 * Best-effort discovery of local Copilot log directories. Copilot only writes
 * these when the user has enabled debug/OTel logging, so callers must treat an
 * empty result as normal, not an error.
 */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

export async function locateCopilotLogDirs(override?: string): Promise<string[]> {
  const candidates: string[] = [];
  if (override) candidates.push(override);

  const home = os.homedir();
  if (process.platform === 'darwin') {
    candidates.push(path.join(home, 'Library', 'Application Support', 'Code', 'logs'));
  } else if (process.platform === 'win32') {
    if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'Code', 'logs'));
  } else {
    candidates.push(path.join(home, '.config', 'Code', 'logs'));
  }

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

/** Shallow walk for Copilot-ish log files, with depth/count caps to stay cheap. */
export async function findLogFiles(
  dir: string,
  maxDepth = 4,
  maxFiles = 200,
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
