import * as assert from 'assert';
import { evaluateRestrictionState } from '../../src/extension-backend/domain/restriction/evaluator';
import { AlertRule } from '../../src/extension-backend/domain/types';

describe('evaluateRestrictionState', () => {
  it('returns null when no rule has a restrict block', () => {
    const rules: AlertRule[] = [
      { id: 'r', severity: 'warning', message: '', when: { '>': [{ var: 'today.credits' }, 0] } },
    ];
    const out = evaluateRestrictionState(rules, { today: { credits: 100 } }, Date.now());
    assert.equal(out.active, null);
    assert.equal(out.matching.length, 0);
  });

  it('selects the matching restrict rule', () => {
    const rules: AlertRule[] = [
      {
        id: 'over-budget',
        severity: 'warning',
        message: 'too high',
        when: { '>': [{ var: 'today.credits' }, 50] },
        restrict: {},
      },
    ];
    const out = evaluateRestrictionState(rules, { today: { credits: 100 } }, Date.now());
    assert.ok(out.active);
    assert.equal(out.active!.id, 'over-budget');
  });

  it('first matching rule wins when several fire at once', () => {
    const rules: AlertRule[] = [
      {
        id: 'first',
        severity: 'warning',
        message: '',
        when: { '>': [{ var: 'today.credits' }, 0] },
        restrict: {},
      },
      {
        id: 'second',
        severity: 'warning',
        message: '',
        when: { '>': [{ var: 'today.credits' }, 0] },
        restrict: {},
      },
    ];
    const out = evaluateRestrictionState(rules, { today: { credits: 100 } }, Date.now());
    assert.equal(out.active!.id, 'first');
  });

  it('skips rules with active=false', () => {
    const rules: AlertRule[] = [
      {
        id: 'r',
        severity: 'warning',
        message: '',
        when: { '>': [{ var: 'today.credits' }, 0] },
        active: false,
        restrict: {},
      },
    ];
    const out = evaluateRestrictionState(rules, { today: { credits: 100 } }, Date.now());
    assert.equal(out.active, null);
  });

  it('skips rules with requiresAuth when not signed in', () => {
    const rules: AlertRule[] = [
      {
        id: 'r',
        severity: 'warning',
        message: '',
        when: { '>': [{ var: 'today.credits' }, 0] },
        requiresAuth: true,
        restrict: {},
      },
    ];
    const out = evaluateRestrictionState(
      rules,
      { today: { credits: 100 }, signedIn: false },
      Date.now(),
    );
    assert.equal(out.active, null);
  });

  it('processes rules where active is a JsonCondition that evaluates to true', () => {
    const rules: AlertRule[] = [
      {
        id: 'r',
        severity: 'warning',
        message: '',
        when: { '>': [{ var: 'today.credits' }, 0] },
        // active condition evaluates to true with credits=100
        active: { '>': [{ var: 'today.credits' }, 0] },
        restrict: {},
      },
    ];
    const out = evaluateRestrictionState(rules, { today: { credits: 100 } }, Date.now());
    assert.notEqual(out.active, null);
  });

  it('skips rules where active is a JsonCondition that evaluates to false', () => {
    const rules: AlertRule[] = [
      {
        id: 'r',
        severity: 'warning',
        message: '',
        when: { '>': [{ var: 'today.credits' }, 0] },
        // active condition: credits > 999 — evaluates to false with credits=1
        active: { '>': [{ var: 'today.credits' }, 999] },
        restrict: {},
      },
    ];
    const out = evaluateRestrictionState(rules, { today: { credits: 1 } }, Date.now());
    assert.equal(out.active, null);
    assert.equal(out.matching.length, 0);
  });

  it('lists a matching rule in canClear only when its reEnableWhen holds', () => {
    // reEnableWhen references a different dimension than `when` so a rule can be
    // matching (wants to restrict) while its clear condition is independently met.
    const rules: AlertRule[] = [
      {
        id: 'r',
        severity: 'warning',
        message: '',
        when: { '>': [{ var: 'today.credits' }, 50] },
        restrict: {
          reEnableWhen: { '<': [{ var: 'mtd.credits' }, 10] },
        },
      },
    ];

    // reEnableWhen true → clearable
    const cleared = evaluateRestrictionState(
      rules,
      { today: { credits: 100 }, mtd: { credits: 5 } },
      Date.now(),
    );
    assert.equal(cleared.matching.length, 1);
    assert.equal(cleared.canClear.length, 1);

    // reEnableWhen false → matching but NOT clearable (was the bug: presence-only check)
    const notCleared = evaluateRestrictionState(
      rules,
      { today: { credits: 100 }, mtd: { credits: 100 } },
      Date.now(),
    );
    assert.equal(notCleared.matching.length, 1);
    assert.equal(notCleared.canClear.length, 0);
  });

  it('skips restrict rules whose when condition evaluates to false', () => {
    const rules: AlertRule[] = [
      {
        id: 'r',
        severity: 'warning',
        message: '',
        when: { '>': [{ var: 'today.credits' }, 999] }, // false with credits=1
        restrict: {},
      },
    ];
    const out = evaluateRestrictionState(rules, { today: { credits: 1 } }, Date.now());
    assert.equal(out.active, null);
    assert.equal(out.matching.length, 0);
  });
});
