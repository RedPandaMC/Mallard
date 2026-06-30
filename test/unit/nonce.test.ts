import { strict as assert } from 'assert';
import { getNonce } from '../../src/client_extension/util/nonce';

describe('getNonce', () => {
  it('returns a non-empty string', () => {
    const n = getNonce();
    assert.ok(typeof n === 'string' && n.length > 0);
  });

  it('returns a valid base64 string', () => {
    const n = getNonce();
    assert.match(n, /^[A-Za-z0-9+/=]+$/);
  });

  it('returns a different value on each call', () => {
    const a = getNonce();
    const b = getNonce();
    assert.notEqual(a, b);
  });

  it('16 random bytes produce a 24-character base64 string', () => {
    // 16 bytes → ceil(16/3)*4 = 24 base64 chars (with padding)
    const n = getNonce();
    assert.equal(n.length, 24);
  });
});
