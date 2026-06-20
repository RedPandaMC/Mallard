/**
 * Restriction engine — owns the on-disk state, idempotently applies
 * disable/enable commands, and exposes a small surface for the host and UI.
 */
import * as vscode from 'vscode';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { AlertRule, DEFAULT_RESTRICTION_STATE, RestrictionState } from '../types';
import { buildRuleContext, EvalBuildInput } from '../expr/context';
import { evaluateRestrictionState } from './evaluator';
import { resolveScopeIds } from './hostScopes';

const STATE_FILE = 'restriction.json';

interface RestrictionSimulateReport {
  state: RestrictionState;
  desired: ReturnType<typeof evaluateRestrictionState>;
  rules: AlertRule[];
  customExtensions: string[];
}

export class RestrictionEngine {
  private readonly _onDidChange = new vscode.EventEmitter<RestrictionState>();
  readonly onDidChange: vscode.Event<RestrictionState> = this._onDidChange.event;

  private state: RestrictionState = { ...DEFAULT_RESTRICTION_STATE };
  private readonly file: string;

  constructor(storageDir: string) {
    mkdirSync(storageDir, { recursive: true });
    this.file = path.join(storageDir, STATE_FILE);
    this.state = this.readFromDisk();
  }

  getState(): RestrictionState {
    return { ...this.state };
  }

  isHardActive(now = Date.now()): boolean {
    if (this.state.userOverrideUntil && this.state.userOverrideUntil > now) return false;
    if (!this.state.active) return false;
    if (this.state.graceExpiresAt && this.state.graceExpiresAt > now) return false;
    return true;
  }

  /** Wipe the restriction and re-enable whatever we previously disabled. */
  async clearAll(): Promise<void> {
    if (this.state.active) {
      const ids = await resolveScopeIds(this.state.scope, this.customExtensions());
      for (const id of ids) {
        try {
          await vscode.commands.executeCommand('workbench.extensions.enableExtension', id);
        } catch {
          /* best-effort */
        }
      }
    }
    this.state = { ...DEFAULT_RESTRICTION_STATE };
    this.writeToDisk();
    this._onDidChange.fire(this.getState());
  }

  /** Snooze any auto-disable for `minutes` from now. */
  async snooze(minutes: number): Promise<void> {
    this.state.userOverrideUntil = Date.now() + minutes * 60_000;
    if (this.state.active) {
      const ids = await resolveScopeIds(this.state.scope, this.customExtensions());
      for (const id of ids) {
        try {
          await vscode.commands.executeCommand('workbench.extensions.enableExtension', id);
        } catch {
          /* best-effort */
        }
      }
    }
    this.writeToDisk();
    this._onDidChange.fire(this.getState());
  }

  /** Recompute against the current context and apply changes. Idempotent. */
  async reconcile(
    input: EvalBuildInput & { rules: AlertRule[]; now?: number },
  ): Promise<RestrictionState> {
    const now = input.now ?? Date.now();
    const ctx = buildRuleContext(input);
    const desired = evaluateRestrictionState(input.rules, ctx, now);
    const customIds = this.customExtensions();
    const state = this.state;

    // Honour active user override
    if (state.userOverrideUntil && state.userOverrideUntil > now) {
      if (state.active) {
        // We're restricted but the user said no — keep the extensions enabled
        // (already done at snooze time) and the banner will say "override".
        return state;
      }
      // Override expired
      if (state.userOverrideUntil <= now) state.userOverrideUntil = null;
    }

    if (!desired.active) {
      // No rule wants to restrict — make sure the state is clean.
      if (state.active) {
        const ids = await resolveScopeIds(state.scope, customIds);
        for (const id of ids) {
          try {
            await vscode.commands.executeCommand('workbench.extensions.enableExtension', id);
          } catch {
            /* best-effort */
          }
        }
        this.state = { ...DEFAULT_RESTRICTION_STATE };
        this.writeToDisk();
        this._onDidChange.fire(this.getState());
      }
      return this.state;
    }

    if (desired.active.restrict?.mode === 'soft') {
      if (!state.active || state.scope !== (desired.active.restrict.scope as string)) {
        this.state = {
          version: 1,
          active: true,
          scope: desired.active.restrict.scope,
          ruleId: desired.active.id,
          reasonMessage: desired.active.message,
          firedAt: now,
          graceExpiresAt: null,
          userOverrideUntil: null,
        };
        this.writeToDisk();
        this._onDidChange.fire(this.getState());
      }
      return this.state;
    }

    // hard restriction
    const graceMin = desired.active.restrict?.graceMinutes ?? 0;
    if (!state.active) {
      const graceExpiresAt = graceMin > 0 ? now + graceMin * 60_000 : null;
      this.state = {
        version: 1,
        active: true,
        scope: desired.active.restrict!.scope,
        ruleId: desired.active.id,
        reasonMessage: desired.active.message,
        firedAt: now,
        graceExpiresAt,
        userOverrideUntil: null,
      };
      this.writeToDisk();
      this._onDidChange.fire(this.getState());
    } else {
      // still restricted; refresh metadata
      this.state.scope = desired.active.restrict!.scope;
      this.state.ruleId = desired.active.id;
      this.state.reasonMessage = desired.active.message;
    }

    if (this.state.graceExpiresAt && this.state.graceExpiresAt <= now) {
      // grace expired → apply the disable
      const ids = await resolveScopeIds(this.state.scope, customIds);
      for (const id of ids) {
        try {
          await vscode.commands.executeCommand('workbench.extensions.disableExtension', id);
        } catch {
          /* best-effort */
        }
      }
    }
    this.writeToDisk();
    this._onDidChange.fire(this.getState());
    return this.state;
  }

  /** Run the evaluator against the supplied context and return the dry-run report. */
  async simulate(
    input: EvalBuildInput & { rules: AlertRule[] },
  ): Promise<RestrictionSimulateReport> {
    const ctx = buildRuleContext(input);
    const desired = evaluateRestrictionState(input.rules, ctx, Date.now());
    return {
      state: this.getState(),
      desired,
      rules: input.rules,
      customExtensions: this.customExtensions(),
    };
  }

  dispose(): void {
    this._onDidChange.dispose();
  }

  private customExtensions(): string[] {
    const raw = vscode.workspace.getConfiguration('mallard').get<unknown>('copilotExtensions');
    return Array.isArray(raw) ? (raw as string[]) : [];
  }

  private readFromDisk(): RestrictionState {
    try {
      const raw = readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<RestrictionState>;
      return { ...DEFAULT_RESTRICTION_STATE, ...parsed };
    } catch {
      return { ...DEFAULT_RESTRICTION_STATE };
    }
  }

  private writeToDisk(): void {
    try {
      writeFileSync(this.file, JSON.stringify(this.state, null, 2) + '\n', 'utf8');
    } catch {
      /* best-effort */
    }
  }
}
