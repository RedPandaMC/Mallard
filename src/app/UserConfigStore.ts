/**
 * Budget and alert configuration, stored as a hand-editable JSON file in the
 * extension's storage directory. The file is the source of truth: the dashboard
 * writes it through {@link set}, and external edits are picked up by a watcher
 * and broadcast via {@link onDidChange}. Values are validated with zod and
 * clamped to sane defaults, so a malformed file degrades gracefully.
 */
import { mkdirSync, readFileSync, writeFileSync, watch, FSWatcher } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { z } from 'zod';
import { DEFAULT_USER_CONFIG, UserConfig } from '../domain/types';

const FILE = 'config.json';

const ConfigSchema = z
  .object({
    monthlyBudget: z.number(),
    includedCredits: z.number(),
    dailyCreditAlert: z.number(),
    alerts: z
      .object({
        velocityEnabled: z.boolean(),
        velocityCreditsPerHour: z.number(),
      })
      .partial(),
  })
  .partial();

export class UserConfigStore implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<UserConfig>();
  readonly onDidChange = this._onDidChange.event;

  private readonly file: string;
  private current: UserConfig;
  private watcher: FSWatcher | undefined;
  private suppressUntil = 0;

  constructor(storageDir: string) {
    mkdirSync(storageDir, { recursive: true });
    this.file = path.join(storageDir, FILE);
    this.current = this.readFromDisk(true);
    this.startWatching();
  }

  /** The on-disk config file, for the "edit config" affordance. */
  get uri(): vscode.Uri {
    return vscode.Uri.file(this.file);
  }

  get(): UserConfig {
    return this.current;
  }

  async set(patch: Partial<UserConfig>): Promise<void> {
    this.current = mergeConfig({
      ...this.current,
      ...patch,
      alerts: { ...this.current.alerts, ...(patch.alerts ?? {}) },
    });
    this.writeToDisk();
    this._onDidChange.fire(this.current);
  }

  /** Restore defaults (used by the full reset). */
  async reset(): Promise<void> {
    this.current = mergeConfig({});
    this.writeToDisk();
    this._onDidChange.fire(this.current);
  }

  dispose(): void {
    this.watcher?.close();
    this._onDidChange.dispose();
  }

  private readFromDisk(seedIfMissing: boolean): UserConfig {
    try {
      const parsed = ConfigSchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')));
      return mergeConfig(parsed.success ? (parsed.data as Partial<UserConfig>) : {});
    } catch {
      const def = mergeConfig({});
      if (seedIfMissing) {
        this.current = def;
        this.writeToDisk();
      }
      return def;
    }
  }

  private writeToDisk(): void {
    this.suppressUntil = Date.now() + 500; // ignore the watch event for our own write
    try {
      writeFileSync(this.file, JSON.stringify(this.current, null, 2) + '\n', 'utf8');
    } catch {
      /* best-effort; in-memory value still applies */
    }
  }

  /** Pick up manual edits to the file and broadcast them. */
  private startWatching(): void {
    try {
      this.watcher = watch(this.file, () => {
        if (Date.now() < this.suppressUntil) return;
        const next = this.readFromDisk(false);
        if (JSON.stringify(next) !== JSON.stringify(this.current)) {
          this.current = next;
          this._onDidChange.fire(this.current);
        }
      });
    } catch {
      /* watching is best-effort */
    }
  }
}

/** Merge a partial over defaults, clamping numbers to be non-negative. */
export function mergeConfig(stored?: Partial<UserConfig>): UserConfig {
  const d = DEFAULT_USER_CONFIG;
  const nonNeg = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
  return {
    monthlyBudget: nonNeg(stored?.monthlyBudget, d.monthlyBudget),
    includedCredits: nonNeg(stored?.includedCredits, d.includedCredits),
    dailyCreditAlert: nonNeg(stored?.dailyCreditAlert, d.dailyCreditAlert),
    alerts: {
      velocityEnabled:
        typeof stored?.alerts?.velocityEnabled === 'boolean'
          ? stored.alerts.velocityEnabled
          : d.alerts.velocityEnabled,
      velocityCreditsPerHour: nonNeg(
        stored?.alerts?.velocityCreditsPerHour,
        d.alerts.velocityCreditsPerHour,
      ),
    },
  };
}
