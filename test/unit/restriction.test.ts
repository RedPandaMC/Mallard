import * as assert from 'assert';
import { evaluateRestrictionState } from '../../src/domain/restriction/evaluator';
import { scopeIds, customIdsFor, knownScopeNames } from '../../src/domain/restriction/scopes';
import { AlertRule } from '../../src/domain/types';

function evalCtx(snapshot: Record<string, unknown> | null) {
  return {
    vars: {},
    resolve: (parts: { name?: string; index?: unknown }[]) => {
      let cur: unknown = snapshot;
      for (const p of parts) {
        if (cur === null || cur === undefined) return null;
        if (p.name !== undefined) {
          if (typeof cur !== 'object') return null;
          cur = (cur as Record<string, unknown>)[p.name];
        } else if (p.index !== undefined) {
          cur = (cur as Record<string, unknown>)[String(p.index)] ?? null;
        }
      }
      return cur === undefined ? null : (cur as never);
    },
    lookupVar: () => null,
  };
}

describe('evaluateRestrictionState', () => {
  it('returns null when no rule has a restrict block', () => {
    const rules: AlertRule[] = [
      { id: 'r', severity: 'warning', message: '', when: 'today.credits > 0' },
    ];
    const out = evaluateRestrictionState(rules, evalCtx({ today: { credits: 100 } }), Date.now());
    assert.equal(out.active, null);
    assert.equal(out.matching.length, 0);
  });

  it('selects the matching hard rule', () => {
    const rules: AlertRule[] = [
      {
        id: 'hard',
        severity: 'warning',
        message: 'too high',
        when: 'today.credits > 50',
        restrict: { mode: 'hard', scope: 'copilot' },
      },
    ];
    const out = evaluateRestrictionState(rules, evalCtx({ today: { credits: 100 } }), Date.now());
    assert.ok(out.active);
    assert.equal(out.active!.id, 'hard');
  });

  it('hard beats soft when both match', () => {
    const rules: AlertRule[] = [
      {
        id: 'soft',
        severity: 'warning',
        message: '',
        when: 'today.credits > 0',
        restrict: { mode: 'soft', scope: 'copilot' },
      },
      {
        id: 'hard',
        severity: 'warning',
        message: '',
        when: 'today.credits > 0',
        restrict: { mode: 'hard', scope: 'copilot' },
      },
    ];
    const out = evaluateRestrictionState(rules, evalCtx({ today: { credits: 100 } }), Date.now());
    assert.equal(out.active!.id, 'hard');
  });

  it('skips rules with active=false', () => {
    const rules: AlertRule[] = [
      {
        id: 'r',
        severity: 'warning',
        message: '',
        when: 'today.credits > 0',
        active: 'false',
        restrict: { mode: 'hard', scope: 'copilot' },
      },
    ];
    const out = evaluateRestrictionState(rules, evalCtx({ today: { credits: 100 } }), Date.now());
    assert.equal(out.active, null);
  });

  it('skips rules with requiresAuth when not signed in', () => {
    const rules: AlertRule[] = [
      {
        id: 'r',
        severity: 'warning',
        message: '',
        when: 'today.credits > 0',
        requiresAuth: true,
        restrict: { mode: 'hard', scope: 'copilot' },
      },
    ];
    const out = evaluateRestrictionState(
      rules,
      evalCtx({ today: { credits: 100 }, signedIn: false }),
      Date.now(),
    );
    assert.equal(out.active, null);
  });

  it('returns matching rules and clears candidates', () => {
    const rules: AlertRule[] = [
      {
        id: 'r',
        severity: 'warning',
        message: '',
        when: 'today.credits > 50',
        restrict: { mode: 'hard', scope: 'copilot', reEnableWhen: 'today.credits < 25' },
      },
    ];
    const out = evaluateRestrictionState(rules, evalCtx({ today: { credits: 100 } }), Date.now());
    assert.equal(out.matching.length, 1);
    assert.equal(out.canClear.length, 1);
  });
});

describe('scope helpers', () => {
  it('scopeIds("copilot") returns the expected extension ids', () => {
    const ids = scopeIds('copilot');
    assert.ok(ids.includes('github.copilot'));
    assert.ok(ids.includes('github.copilot-chat'));
  });

  it('scopeIds("copilot+lab") includes labs/nightly', () => {
    const ids = scopeIds('copilot+lab');
    assert.ok(ids.includes('github.copilot-labs'));
    assert.ok(ids.includes('github.copilot-nightly'));
  });

  it('scopeIds("custom") returns an empty list', () => {
    assert.deepStrictEqual(scopeIds('custom'), []);
  });

  it('scopeIds(unknown) falls back to copilot', () => {
    const ids = scopeIds('made-up');
    assert.ok(ids.includes('github.copilot'));
  });

  it('customIdsFor routes by scope', () => {
    assert.deepStrictEqual(customIdsFor('custom', ['a', 'b']), ['a', 'b']);
    assert.deepStrictEqual(customIdsFor('copilot', ['a']), []);
  });

  it('knownScopeNames returns the three named scopes', () => {
    const names = knownScopeNames();
    assert.ok(names.includes('copilot'));
    assert.ok(names.includes('copilot+lab'));
    assert.ok(names.includes('custom'));
  });
});
