import { strict as assert } from 'assert';
import { evalCondition, resolveVar, JsonConditionSchema } from '../../src/domain/expr/jsonCondition';
import type { JsonCondition } from '../../src/domain/types';

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
