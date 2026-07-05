import { strict as assert } from 'assert';
import { evalCondition, evalSimpleCondition, evalRule, compileConditions, resolveVar, JsonConditionSchema } from '../../src/extension-backend/domain/expr/jsonCondition';
import type { JsonCondition, JsonOperand } from '../../src/extension-backend/domain/types';

const ctx: Record<string, unknown> = {
  today: { credits: 50, cost: 2.5, tokens: 1000 },
  budget: { percentOfBudget: 0.4 },
  flag: true,
  empty: '',
};

describe('resolveVar', () => {
  it('resolves a top-level key', () => {
    assert.equal(resolveVar('flag', ctx), true);
  });

  it('resolves a dot-nested path', () => {
    assert.equal(resolveVar('today.credits', ctx), 50);
  });

  it('returns undefined for a missing segment', () => {
    assert.equal(resolveVar('today.missing', ctx), undefined);
  });

  it('returns undefined when a mid-path segment is not an object', () => {
    assert.equal(resolveVar('flag.child', ctx), undefined);
  });

  it('returns undefined for an unknown top-level key', () => {
    assert.equal(resolveVar('unknown', ctx), undefined);
  });
});

describe('evalCondition — literals', () => {
  it('literal true returns true', () => {
    assert.equal(evalCondition(true, ctx), true);
  });

  it('literal false returns false', () => {
    assert.equal(evalCondition(false, ctx), false);
  });
});

describe('evalCondition — var truthy check', () => {
  it('present truthy value is true', () => {
    assert.equal(evalCondition({ var: 'flag' }, ctx), true);
  });

  it('absent path is falsy (undefined)', () => {
    assert.equal(evalCondition({ var: 'nonexistent' }, ctx), false);
  });

  it('empty string is falsy', () => {
    assert.equal(evalCondition({ var: 'empty' }, ctx), false);
  });
});

describe('evalCondition — comparison operators', () => {
  it('> fires when left > right', () => {
    assert.equal(evalCondition({ '>': [{ var: 'today.credits' }, 40] }, ctx), true);
  });

  it('> does not fire when left <= right', () => {
    assert.equal(evalCondition({ '>': [{ var: 'today.credits' }, 50] }, ctx), false);
  });

  it('>= fires when left >= right', () => {
    assert.equal(evalCondition({ '>=': [{ var: 'today.credits' }, 50] }, ctx), true);
  });

  it('< fires when left < right', () => {
    assert.equal(evalCondition({ '<': [{ var: 'today.credits' }, 60] }, ctx), true);
  });

  it('<= fires when left <= right', () => {
    assert.equal(evalCondition({ '<=': [{ var: 'today.credits' }, 50] }, ctx), true);
  });

  it('== fires on strict equality (number)', () => {
    assert.equal(evalCondition({ '==': [{ var: 'today.credits' }, 50] }, ctx), true);
  });

  it('== does not coerce types', () => {
    assert.equal(evalCondition({ '==': [{ var: 'today.credits' }, '50'] }, ctx), false);
  });

  it('!= fires when values differ', () => {
    assert.equal(evalCondition({ '!=': [{ var: 'today.credits' }, 99] }, ctx), true);
  });

  it('!= does not fire on equal values', () => {
    assert.equal(evalCondition({ '!=': [{ var: 'today.credits' }, 50] }, ctx), false);
  });

  it('numeric op returns false when either side is NaN', () => {
    assert.equal(evalCondition({ '>': [NaN, 0] }, {}), false);
    assert.equal(evalCondition({ '<': [NaN, 0] }, {}), false);
  });

  it('literal operands work without var reference', () => {
    assert.equal(evalCondition({ '>': [10, 5] }, {}), true);
    assert.equal(evalCondition({ '>': [5, 10] }, {}), false);
  });
});

describe('evalCondition — boolean operators', () => {
  it('and: all-true fires', () => {
    const cond: JsonCondition = { and: [
      { '>': [{ var: 'today.credits' }, 40] },
      { '<': [{ var: 'budget.percentOfBudget' }, 1] },
    ] };
    assert.equal(evalCondition(cond, ctx), true);
  });

  it('and: short-circuits on first false', () => {
    const cond: JsonCondition = { and: [false, true] };
    assert.equal(evalCondition(cond, ctx), false);
  });

  it('and: empty array is true', () => {
    assert.equal(evalCondition({ and: [] }, ctx), true);
  });

  it('or: short-circuits on first true', () => {
    const cond: JsonCondition = { or: [true, false] };
    assert.equal(evalCondition(cond, ctx), true);
  });

  it('or: all-false is false', () => {
    const cond: JsonCondition = { or: [false, false] };
    assert.equal(evalCondition(cond, ctx), false);
  });

  it('or: empty array is false', () => {
    assert.equal(evalCondition({ or: [] }, ctx), false);
  });

  it('not: inverts true to false', () => {
    assert.equal(evalCondition({ not: true }, ctx), false);
  });

  it('not: inverts false to true', () => {
    assert.equal(evalCondition({ not: false }, ctx), true);
  });

  it('double not is identity', () => {
    const original: JsonCondition = { '>': [{ var: 'today.credits' }, 0] };
    assert.equal(evalCondition({ not: { not: original } }, ctx), evalCondition(original, ctx));
  });
});

describe('evalCondition — deep nesting', () => {
  it('nested and/or/not evaluates correctly', () => {
    const cond: JsonCondition = { and: [
      { or: [false, { '>': [{ var: 'today.credits' }, 40] }] },
      { not: { '>=': [{ var: 'budget.percentOfBudget' }, 1] } },
    ] };
    assert.equal(evalCondition(cond, ctx), true);
  });
});

describe('JsonConditionSchema', () => {
  it('accepts a valid comparison object', () => {
    const r = JsonConditionSchema.safeParse({ '>': [{ var: 'today.credits' }, 50] });
    assert.equal(r.success, true);
  });

  it('accepts boolean literals', () => {
    assert.equal(JsonConditionSchema.safeParse(true).success, true);
    assert.equal(JsonConditionSchema.safeParse(false).success, true);
  });

  it('accepts and/or/not', () => {
    assert.equal(JsonConditionSchema.safeParse({ and: [true, false] }).success, true);
    assert.equal(JsonConditionSchema.safeParse({ or: [true] }).success, true);
    assert.equal(JsonConditionSchema.safeParse({ not: true }).success, true);
  });

  it('rejects an unknown operator key', () => {
    const r = JsonConditionSchema.safeParse({ 'xor': [true, false] });
    assert.equal(r.success, false);
  });

  it('rejects a comparison with wrong arity (3 operands)', () => {
    const r = JsonConditionSchema.safeParse({ '>': [1, 2, 3] });
    assert.equal(r.success, false);
  });

  it('rejects a non-object, non-boolean value', () => {
    const r = JsonConditionSchema.safeParse('today.credits > 0');
    assert.equal(r.success, false);
  });
});

describe('evalSimpleCondition', () => {
  const ctx = { today: { credits: 75 }, topModel: { id: 'claude-sonnet-4' } };

  it('evaluates numeric comparison', () => {
    assert.equal(evalSimpleCondition({ field: 'today.credits', op: '>', value: 50 }, ctx), true);
    assert.equal(evalSimpleCondition({ field: 'today.credits', op: '>', value: 100 }, ctx), false);
  });

  it('evaluates in operator', () => {
    assert.equal(evalSimpleCondition({ field: 'topModel.id', op: 'in', value: ['claude-sonnet-4', 'gpt-4o'] }, ctx), true);
    assert.equal(evalSimpleCondition({ field: 'topModel.id', op: 'in', value: ['gpt-4o'] }, ctx), false);
  });

  it('evaluates in operator with scalar value (non-array)', () => {
    assert.equal(evalSimpleCondition({ field: 'topModel.id', op: 'in', value: 'claude-sonnet-4' as unknown as string[] }, ctx), true);
    assert.equal(evalSimpleCondition({ field: 'topModel.id', op: 'in', value: 'gpt-4o' as unknown as string[] }, ctx), false);
  });

  it('evaluates matches operator with regex', () => {
    assert.equal(evalSimpleCondition({ field: 'topModel.id', op: 'matches', value: '^claude-' }, ctx), true);
    assert.equal(evalSimpleCondition({ field: 'topModel.id', op: 'matches', value: '^gpt-' }, ctx), false);
  });

  it('matches operator coerces undefined fieldValue to empty string', () => {
    assert.equal(evalSimpleCondition({ field: 'nonexistent', op: 'matches', value: '^$' }, ctx), true);
    assert.equal(evalSimpleCondition({ field: 'nonexistent', op: 'matches', value: '^claude' }, ctx), false);
  });

  it('returns false for matches with invalid regex', () => {
    assert.equal(evalSimpleCondition({ field: 'topModel.id', op: 'matches', value: '[invalid(' }, ctx), false);
  });

  it('returns false for a matches pattern rejected by the ReDoS safety guard', () => {
    // Contains `(?` — flagged as unsafe before ever compiling the RegExp.
    assert.equal(evalSimpleCondition({ field: 'topModel.id', op: 'matches', value: '(?:a)' }, ctx), false);
  });
});

describe('compileConditions', () => {
  const ctx = { today: { credits: 75 } };

  it('returns true for empty conditions', () => {
    assert.equal(evalCondition(compileConditions([]), ctx), true);
  });

  it('all match = AND', () => {
    const cond = compileConditions([
      { field: 'today.credits', op: '>', value: 50 },
      { field: 'today.credits', op: '<', value: 100 },
    ], 'all');
    assert.equal(evalCondition(cond, ctx), true);
  });

  it('any match = OR', () => {
    const cond = compileConditions([
      { field: 'today.credits', op: '>', value: 100 },
      { field: 'today.credits', op: '>', value: 50 },
    ], 'any');
    assert.equal(evalCondition(cond, ctx), true);
  });

  it('none match = NOR', () => {
    const cond = compileConditions([
      { field: 'today.credits', op: '>', value: 100 },
    ], 'none');
    assert.equal(evalCondition(cond, ctx), true);
  });

  it('in condition with ctx pre-evaluates via evalSimpleCondition', () => {
    const evalCtx = { topModel: { id: 'claude-sonnet-4' } };
    const cond = compileConditions(
      [{ field: 'topModel.id', op: 'in', value: ['claude-sonnet-4', 'gpt-4o'] }],
      'all',
      evalCtx,
    );
    // Pre-evaluated to a boolean literal
    assert.equal(cond, true);
  });

  it('in condition without ctx returns true literal', () => {
    const cond = compileConditions(
      [{ field: 'topModel.id', op: 'in', value: ['claude-sonnet-4'] }],
      'all',
    );
    assert.equal(cond, true);
  });

  it('none match with multiple conditions returns { not: { or: [...] } }', () => {
    const evalCtx = { today: { credits: 75 } };
    const cond = compileConditions(
      [
        { field: 'today.credits', op: '>' as const, value: 100 },
        { field: 'today.credits', op: '>' as const, value: 200 },
      ],
      'none',
    );
    assert.equal(evalCondition(cond, evalCtx), true); // none match (both false)
  });
});

describe('resolveVar — edge cases', () => {
  it('resolves __proto__ path without throwing (read-only access to prototype)', () => {
    assert.doesNotThrow(() => resolveVar('__proto__', {}));
    assert.doesNotThrow(() => resolveVar('__proto__.toString', {}));
  });

  it('returns undefined when mid-path value is a primitive (stops traversal)', () => {
    assert.equal(resolveVar('a.b.c.d.e', { a: { b: 42 } }), undefined);
  });

  it('handles an empty-string path segment when key is absent on the object', () => {
    // 'a..b' splits to ['a', '', 'b'] — the '' key does not exist here → undefined
    assert.equal(resolveVar('a..b', { a: { noEmptyKey: 1 } }), undefined);
  });
});

describe('evalCondition — non-numeric string operands', () => {
  it('returns false for > when left side is a non-numeric string', () => {
    assert.equal(evalCondition({ '>': ['abc', 5] }, {}), false);
  });

  it('returns false for < when both sides are non-numeric strings', () => {
    assert.equal(evalCondition({ '<': ['abc', 'def'] }, {}), false);
  });

  it('== does not coerce non-numeric strings to numbers', () => {
    assert.equal(evalCondition({ '==': ['5', 5] }, {}), false);
  });
});

describe('evalRule', () => {
  const ctx = { today: { credits: 75 } };

  it('uses "when" when present', () => {
    const rule = { when: { '>': [{ var: 'today.credits' }, 50] as [JsonOperand, JsonOperand] } };
    assert.equal(evalRule(rule, ctx), true);
  });

  it('uses "conditions" when "when" is absent', () => {
    const rule = { conditions: [{ field: 'today.credits', op: '>' as const, value: 50 }] };
    assert.equal(evalRule(rule, ctx), true);
  });

  it('returns false when neither when nor conditions', () => {
    assert.equal(evalRule({}, ctx), false);
  });

  it('evaluates conditions with match=none via evalRuleConditions', () => {
    const rule = {
      conditions: [
        { field: 'today.credits', op: '>' as const, value: 100 },
        { field: 'today.credits', op: '>' as const, value: 200 },
      ],
      match: 'none' as const,
    };
    assert.equal(evalRule(rule, ctx), true); // credits=75, none match (both fail)
    const rule2 = {
      conditions: [{ field: 'today.credits', op: '>' as const, value: 50 }],
      match: 'none' as const,
    };
    assert.equal(evalRule(rule2, ctx), false); // credits=75 > 50, so "some" match → none=false
  });
});
