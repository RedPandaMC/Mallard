/**
 * Budget and alert configuration, stored as a hand-editable JSON file in the
 * extension's storage directory. The file is the source of truth: the dashboard
 * writes it through {@link set}, and external edits are picked up by a watcher
 * and broadcast via {@link onDidChange}. Values are validated with zod and
 * clamped to sane defaults, so a malformed file degrades gracefully.
 */
import { watch, FSWatcher } from 'fs';
import * as vscode from 'vscode';
import { z } from 'zod';
import { UserConfig, SEED_USER_CONFIG } from '../domain/types';
import { JsonConditionSchema } from '../domain/expr/jsonCondition';
import { JsonFileStore } from '../util/JsonFileStore';
import { mergeConfig } from './mergeConfig';

export { mergeConfig } from './mergeConfig';

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
    version: z.union([z.literal(1), z.literal(2)]).optional(),
    vars: z.record(z.string(), z.unknown()).optional(),
    groups: z
      .array(
        z.object({
          id: z.string(),
          label: z.string().optional(),
          active: JsonConditionSchema,
        }),
      )
      .optional(),
    rules: z
      .array(
        z.object({
          id: z.string(),
          severity: z.enum(['info', 'warning', 'critical']),
          cooldown: z.string().optional(),
          message: z.string(),
          when: JsonConditionSchema,
          active: JsonConditionSchema.optional(),
          requiresAuth: z.boolean().optional(),
          notify: z.boolean().optional(),
          restrict: z
            .object({
              reEnableWhen: JsonConditionSchema.optional(),
            })
            .optional(),
        }),
      )
      .optional(),
    budget: z
      .object({
        monthlyUsd: z.number(),
        includedCredits: z.number(),
      })
      .optional(),
    branchBudgets: z.record(z.string(), z.number()).optional(),
    // The blocks below were documented in schemas/mallard-config.schema.json
    // but missing here — zod strips unknown keys, so config.json's
    // githubBilling/dashboard/display never survived a read.
    githubBilling: z
      .object({
        mode: z.enum(['vscode-session', 'pat']).optional(),
        org: z.string().optional(),
      })
      .optional(),
    dashboard: z
      .object({
        columns: z.number().optional(),
        panels: z
          .array(
            z.object({
              id: z.string(),
              gridColumn: z.string().optional(),
              gridRow: z.string().optional(),
              hidden: z.boolean().optional(),
              size: z.enum(['compact', 'normal', 'tall']).optional(),
            }),
          )
          .optional(),
      })
      .optional(),
    display: z
      .object({
        dailyBarsWindow: z.number().optional(),
        heatmapWeeks: z.number().optional(),
        topN: z.number().optional(),
      })
      .optional(),
    export: z
      .object({
        webhookTargets: z
          .array(z.object({ name: z.string().min(1), url: z.string().min(1) }))
          .optional(),
        mqttTargets: z
          .array(z.object({ name: z.string().min(1), url: z.string().min(1) }))
          .optional(),
      })
      .optional(),
  })
  .partial();

export class UserConfigStore implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<UserConfig>();
  readonly onDidChange = this._onDidChange.event;

  private readonly store: JsonFileStore<UserConfig>;
  private current: UserConfig;
  private watcher: FSWatcher | undefined;
  private suppressUntil = 0;

  constructor(storageDir: string) {
    this.store = new JsonFileStore<UserConfig>(storageDir, FILE);
    this.current = this.readFromDisk(true);
    this.startWatching();
  }

  /** The on-disk config file, for the "edit config" affordance. */
  get uri(): vscode.Uri {
    return vscode.Uri.file(this.store.file);
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
    const raw = this.store.read();
    if (raw === undefined) {
      const def = seedIfMissing ? mergeConfig(SEED_USER_CONFIG) : mergeConfig({});
      if (seedIfMissing) {
        this.current = def;
        this.writeToDisk();
      }
      return def;
    }
    const parsed = ConfigSchema.safeParse(raw);
    return mergeConfig(parsed.success ? (parsed.data as Partial<UserConfig>) : {});
  }

  private writeToDisk(): void {
    this.suppressUntil = Date.now() + 500; // ignore the watch event for our own write
    this.store.write(this.current);
  }

  /** Pick up manual edits to the file and broadcast them. */
  private startWatching(): void {
    try {
      this.watcher = watch(this.store.file, () => {
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
