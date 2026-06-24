import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const DUCKDB_FILES = ['events.duckdb', 'events.duckdb.wal'];

/** Wipe all Mallard-owned DuckDB files from globalStorageUri. */
export async function cleanupStorage(storageDir: string): Promise<void> {
  for (const name of DUCKDB_FILES) {
    try {
      await fs.unlink(path.join(storageDir, name));
    } catch {
      // already gone — not an error
    }
  }
}

/** Clear all globalState keys written by Mallard. */
export async function cleanupGlobalState(state: vscode.Memento): Promise<void> {
  for (const key of state.keys()) {
    await state.update(key, undefined);
  }
}
