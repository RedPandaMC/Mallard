import { strict as assert } from 'assert';
import { changed } from '../../webview/chartDiff';

describe('changed', () => {
  it('returns true when prev is undefined', () => {
    assert.ok(changed(undefined, { a: 1 }));
  });

  it('returns false for deeply equal values', () => {
    assert.ok(!changed({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] }));
  });

  it('returns true when a nested value differs', () => {
    assert.ok(changed({ a: 1, b: [1, 2] }, { a: 1, b: [1, 3] }));
  });

  it('returns true when key is added', () => {
    assert.ok(changed({ a: 1 }, { a: 1, b: 2 }));
  });

  it('handles primitive types', () => {
    assert.ok(!changed(42, 42));
    assert.ok(changed(42, 43));
    assert.ok(!changed('x', 'x'));
    assert.ok(changed('x', 'y'));
  });
});
