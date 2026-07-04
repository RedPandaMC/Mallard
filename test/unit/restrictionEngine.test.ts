import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RestrictionEngine } from '../../src/extension-backend/domain/restriction/engine';
import { buildSnapshot } from '../../src/extension-backend/domain/snapshot';
import { makeEvent } from './helpers';
import type { AlertRule, RestrictionState } from '../../src/extension-backend/domain/types';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mallard-restriction-'));
}

function snapshot(credits = 100) {
  return buildSnapshot([makeEvent({ ts: Date.now() - 1000, credits })], {
    now: Date.now(),
    currency: 'USD',
    pricePerCredit: 0.04,
    monthlyBudget: null,
    includedCredits: 300,
    filter: {},
    source: 'local',
    status: { kind: 'ok' },
    authStatus: 'signed-out',
  });
}

const RESTRICT_RULE: AlertRule = {
  id: 'stop-at-50',
  severity: 'critical',
  message: 'Over 50 credits',
  when: { '>': [{ var: 'today.credits' }, 50] },
  restrict: {},
};

describe('RestrictionEngine', () => {
  it('starts inactive with the default state', async () => {
    const engine = new RestrictionEngine(await tmpDir());
    const state = engine.getState();
    assert.equal(state.active, false);
    assert.equal(engine.isRestricted(), false);
    engine.dispose();
  });

  it('reconcile activates a matching restrict rule and persists across instances', async () => {
    const dir = await tmpDir();
    const engine = new RestrictionEngine(dir);
    const fired: RestrictionState[] = [];
    engine.onDidChange((s) => fired.push(s));

    const state = await engine.reconcile({
      snapshot: snapshot(100),
      rules: [RESTRICT_RULE],
      signedIn: false,
    });

    assert.equal(state.active, true);
    assert.equal(state.ruleId, 'stop-at-50');
    assert.equal(engine.isRestricted(), true);
    assert.ok(fired.length >= 1);
    engine.dispose();

    // A fresh engine on the same storage dir reads the persisted state.
    const engine2 = new RestrictionEngine(dir);
    assert.equal(engine2.getState().active, true);
    engine2.dispose();
  });

  it('reconcile deactivates when the rule no longer matches', async () => {
    const dir = await tmpDir();
    const engine = new RestrictionEngine(dir);
    await engine.reconcile({ snapshot: snapshot(100), rules: [RESTRICT_RULE], signedIn: false });
    assert.equal(engine.isRestricted(), true);

    await engine.reconcile({ snapshot: snapshot(10), rules: [RESTRICT_RULE], signedIn: false });
    assert.equal(engine.isRestricted(), false);
    engine.dispose();
  });

  it('snooze suppresses isRestricted until the override expires', async () => {
    const engine = new RestrictionEngine(await tmpDir());
    await engine.reconcile({ snapshot: snapshot(100), rules: [RESTRICT_RULE], signedIn: false });
    assert.equal(engine.isRestricted(), true);

    await engine.snooze(15);
    assert.equal(engine.isRestricted(), false, 'snoozed');
    assert.equal(engine.getState().active, true, 'still active underneath');
    assert.equal(engine.isRestricted(Date.now() + 16 * 60_000), true, 'expired override');
    engine.dispose();
  });

  it('clearAll wipes the state back to defaults', async () => {
    const engine = new RestrictionEngine(await tmpDir());
    await engine.reconcile({ snapshot: snapshot(100), rules: [RESTRICT_RULE], signedIn: false });
    await engine.clearAll();
    const state = engine.getState();
    assert.equal(state.active, false);
    assert.equal(state.ruleId, '');
    engine.dispose();
  });

  it('simulate reports the desired state without mutating the engine', async () => {
    const engine = new RestrictionEngine(await tmpDir());
    const report = await engine.simulate({
      snapshot: snapshot(100),
      rules: [RESTRICT_RULE],
      signedIn: false,
    });
    assert.equal(report.state.active, false, 'simulate must not apply');
    assert.ok(report.desired);
    assert.deepEqual(report.rules, [RESTRICT_RULE]);
    assert.equal(engine.getState().active, false);
    engine.dispose();
  });

  it('a malformed state file degrades to the default state', async () => {
    const dir = await tmpDir();
    await fs.writeFile(path.join(dir, 'restriction.json'), '{not json', 'utf8');
    const engine = new RestrictionEngine(dir);
    assert.equal(engine.getState().active, false);
    engine.dispose();
  });

  it('reconcile honours an active override while restricted (returns early)', async () => {
    const dir = await tmpDir();
    const engine = new RestrictionEngine(dir);
    await engine.reconcile({ snapshot: snapshot(100), rules: [RESTRICT_RULE], signedIn: false });
    assert.equal(engine.getState().active, true);
    await engine.snooze(15); // override active, state.active stays true underneath
    const state = await engine.reconcile({
      snapshot: snapshot(100),
      rules: [RESTRICT_RULE],
      signedIn: false,
      now: Date.now() + 5 * 60_000, // override still active
    });
    // Early-return: state unchanged (still active, override still set, no new fire)
    assert.equal(state.active, true);
    assert.ok(state.userOverrideUntil);
    engine.dispose();
  });

  it('reconcile refreshes the message when the same rule stays active but its text changes', async () => {
    const dir = await tmpDir();
    const engine = new RestrictionEngine(dir);
    await engine.reconcile({
      snapshot: snapshot(100),
      rules: [RESTRICT_RULE],
      signedIn: false,
    });
    const original = engine.getState().reasonMessage;
    const updatedRule: AlertRule = { ...RESTRICT_RULE, message: 'Over 50 credits — UPDATED' };
    await engine.reconcile({
      snapshot: snapshot(100),
      rules: [updatedRule],
      signedIn: false,
    });
    assert.notEqual(engine.getState().reasonMessage, original);
    assert.equal(engine.getState().reasonMessage, 'Over 50 credits — UPDATED');
    engine.dispose();
  });
});
