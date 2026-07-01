/**
 * Restriction engine — owns the on-disk popup state and exposes a small
 * surface for the host and UI. Never disables any extension; it only tracks
 * whether the restriction popup (Dismiss/Snooze/Disable Mallard) should show.
 */
import * as vscode from 'vscode';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { AlertRule, DEFAULT_RESTRICTION_STATE, RestrictionState } from '../types';
import { buildRuleContext, EvalBuildInput } from '../expr/context';
import { evaluateRestrictionState } from './evaluator';

const STATE_FILE = 'restriction.json';

interface RestrictionSimulateReport {
  state: RestrictionState;
  desired: ReturnType<typeof evaluateRestrictionState>;
  rules: AlertRule[];
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

  isRestricted(now = Date.now()): boolean {
    if (this.state.userOverrideUntil && this.state.userOverrideUntil > now) return false;
    return this.state.active;
  }

  /** Wipe the restriction state. */
  async clearAll(): Promise<void> {
    this.state = { ...DEFAULT_RESTRICTION_STATE };
    this.writeToDisk();
    this._onDidChange.fire(this.getState());
  }

  /** Snooze the active restriction for `minutes` from now. */
  async snooze(minutes: number): Promise<void> {
    this.state.userOverrideUntil = Date.now() + minutes * 60_000;
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
        this.state = { ...DEFAULT_RESTRICTION_STATE };
        this.writeToDisk();
        this._onDidChange.fire(this.getState());
      }
      return this.state;
    }

    if (!state.active || state.ruleId !== desired.active.id) {
      this.state = {
        version: 1,
        active: true,
        ruleId: desired.active.id,
        reasonMessage: desired.active.message,
        firedAt: now,
        userOverrideUntil: null,
      };
      this.writeToDisk();
      this._onDidChange.fire(this.getState());
    } else if (this.state.reasonMessage !== desired.active.message) {
      // still restricted by the same rule; refresh the message in case it changed
      this.state.reasonMessage = desired.active.message;
      this.writeToDisk();
      this._onDidChange.fire(this.getState());
    }

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
    };
  }

  dispose(): void {
    this._onDidChange.dispose();
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
