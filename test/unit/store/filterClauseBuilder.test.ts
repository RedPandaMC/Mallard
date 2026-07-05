import { strict as assert } from 'assert';
import { FilterClauseBuilder } from '../../../src/extension-backend/store/FilterClauseBuilder';
import { UNATTRIBUTED_REPO } from '../../../src/extension-backend/domain/aggregate';

describe('FilterClauseBuilder', () => {
  it('build() returns an empty string with no conditions', () => {
    const fb = new FilterClauseBuilder();
    assert.equal(fb.build(), '');
    assert.deepEqual(fb.params, []);
  });

  it('addRange() adds a half-open [start, end) condition', () => {
    const fb = new FilterClauseBuilder().addRange({ start: 10, end: 20 });
    assert.equal(fb.build(), 'WHERE ts >= ? AND ts < ?');
    assert.deepEqual(fb.params, [10, 20]);
  });

  it('addRange() applies the value transform to both bounds', () => {
    const fb = new FilterClauseBuilder().addRange({ start: 10, end: 20 }, 'f.date_id', (v) => v * 2);
    assert.equal(fb.build(), 'WHERE f.date_id >= ? AND f.date_id < ?');
    assert.deepEqual(fb.params, [20, 40]);
  });

  it('addRange() is a no-op without a range', () => {
    assert.equal(new FilterClauseBuilder().addRange(undefined).build(), '');
  });

  it('addIn() builds an IN clause with one placeholder per value', () => {
    const fb = new FilterClauseBuilder().addIn(['a', 'b'], 'modelId');
    assert.equal(fb.build(), 'WHERE modelId IN (?,?)');
    assert.deepEqual(fb.params, ['a', 'b']);
  });

  it('addIn() is a no-op for undefined or empty values', () => {
    assert.equal(new FilterClauseBuilder().addIn(undefined, 'x').build(), '');
    assert.equal(new FilterClauseBuilder().addIn([], 'x').build(), '');
  });

  it('addRepos() handles named repos, the unattributed sentinel, and both', () => {
    const named = new FilterClauseBuilder().addRepos(['org/a'], 'repo', 'repo IS NULL');
    assert.equal(named.build(), 'WHERE (repo IN (?))');
    assert.deepEqual(named.params, ['org/a']);

    const unattr = new FilterClauseBuilder().addRepos([UNATTRIBUTED_REPO], 'repo', 'repo IS NULL');
    assert.equal(unattr.build(), 'WHERE (repo IS NULL)');
    assert.deepEqual(unattr.params, []);

    const both = new FilterClauseBuilder().addRepos(['org/a', UNATTRIBUTED_REPO], 'repo', 'repo IS NULL');
    assert.equal(both.build(), 'WHERE (repo IN (?) OR repo IS NULL)');
  });

  it('chains conditions with AND', () => {
    const fb = new FilterClauseBuilder()
      .addRange({ start: 1, end: 2 })
      .addIn(['gpt-4o'], 'modelId');
    assert.equal(fb.build(), 'WHERE ts >= ? AND ts < ? AND modelId IN (?)');
    assert.deepEqual(fb.params, [1, 2, 'gpt-4o']);
  });
});
