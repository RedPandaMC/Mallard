import { strict as assert } from 'assert';
import { FilterClauseBuilder } from '../../src/store/FilterClauseBuilder';

describe('FilterClauseBuilder', () => {
  it('build() returns empty string when no conditions added', () => {
    const fb = new FilterClauseBuilder();
    assert.strictEqual(fb.build(), '');
    assert.deepStrictEqual(fb.params, []);
  });

  it('addRange() with no transform uses raw values', () => {
    const fb = new FilterClauseBuilder().addRange({ start: 100, end: 200 }, 'ts');
    assert.ok(fb.build().includes('ts >= ?'));
    assert.deepStrictEqual(fb.params, [100, 200]);
  });

  it('addRange() uses default col when omitted', () => {
    const fb = new FilterClauseBuilder().addRange({ start: 10, end: 20 });
    assert.ok(fb.build().includes('ts >= ?'));
  });

  it('addRange() with a transform applies it to both bounds', () => {
    const double = (v: number) => v * 2;
    const fb = new FilterClauseBuilder().addRange({ start: 10, end: 20 }, 'col', double);
    assert.ok(fb.build().includes('col >= ?'));
    assert.deepStrictEqual(fb.params, [20, 40]);
  });

  it('addRange() with undefined range adds no condition', () => {
    const fb = new FilterClauseBuilder().addRange(undefined, 'ts');
    assert.strictEqual(fb.build(), '');
  });

  it('addIn() adds an IN clause for non-empty arrays', () => {
    const fb = new FilterClauseBuilder().addIn(['a', 'b'], 'model');
    assert.ok(fb.build().includes('model IN (?,?)'));
    assert.deepStrictEqual(fb.params, ['a', 'b']);
  });

  it('addIn() skips empty or undefined arrays', () => {
    const fb = new FilterClauseBuilder().addIn(undefined, 'model').addIn([], 'surface');
    assert.strictEqual(fb.build(), '');
  });

  it('addRepos() adds named repos and unattributed separately', () => {
    const fb = new FilterClauseBuilder().addRepos(['org/x', 'unattributed'], 'repo', 'repo IS NULL');
    const clause = fb.build();
    // Named repos become params, not literal strings in the clause
    assert.ok(fb.params.includes('org/x'));
    assert.ok(clause.includes('repo IS NULL'));
  });

  it('addRepos() skips when repos is undefined', () => {
    const fb = new FilterClauseBuilder().addRepos(undefined, 'repo', 'repo IS NULL');
    assert.strictEqual(fb.build(), '');
  });

  it('chains multiple conditions with AND', () => {
    const fb = new FilterClauseBuilder()
      .addIn(['gpt-4o'], 'modelId')
      .addIn(['chat'], 'surface');
    assert.ok(fb.build().includes('AND'));
  });
});
