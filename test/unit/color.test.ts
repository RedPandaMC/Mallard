import * as assert from 'assert';
import {
  parseColor,
  toHex,
  contrastRatio,
  ensureContrast,
  distinctUnderCvd,
  deriveAccent,
} from '../../src/extension-frontend/color';

describe('color utilities', () => {
  it('parses hex (3/6 digit) and rgb()/rgba() strings', () => {
    assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255 });
    assert.deepEqual(parseColor('#E5231B'), { r: 229, g: 35, b: 27 });
    assert.deepEqual(parseColor('rgb(10, 20, 30)'), { r: 10, g: 20, b: 30 });
    assert.deepEqual(parseColor('rgba(10 20 30 / 0.5)'), { r: 10, g: 20, b: 30 });
    assert.equal(parseColor('not-a-colour'), null);
  });

  it('computes WCAG contrast (black vs white is 21:1)', () => {
    const black = parseColor('#000')!;
    const white = parseColor('#fff')!;
    assert.ok(Math.abs(contrastRatio(black, white) - 21) < 0.01);
    assert.ok(Math.abs(contrastRatio(white, white) - 1) < 0.01);
  });

  it('ensureContrast raises a low-contrast colour to ≥3:1', () => {
    const bg = parseColor('#1e1e1e')!; // dark editor background
    const dim = parseColor('#2a2a2a')!; // nearly invisible on it
    assert.ok(contrastRatio(dim, bg) < 3);
    const fixed = ensureContrast(dim, bg, 3);
    assert.ok(contrastRatio(fixed, bg) >= 3, 'nudged colour should clear 3:1');
  });

  it('the Swiss red stays distinct from mid-gray under all CVD types', () => {
    const red = parseColor('#e5231b')!;
    const gray = { r: 130, g: 130, b: 130 };
    assert.ok(distinctUnderCvd(red, gray));
  });

  it('deriveAccent floors saturation for a near-gray seed', () => {
    // A gray seed cannot carry an accent role; it must be pushed to a
    // saturated, CVD-distinct colour rather than passed through as gray.
    const accent = parseColor(deriveAccent('#808080', '#1e1e1e'))!;
    assert.ok(distinctUnderCvd(accent, { r: 130, g: 130, b: 130 }));
  });

  it('deriveAccent keeps a vivid theme seed and stays legible on the bg', () => {
    const accent = parseColor(deriveAccent('#0e639c', '#1e1e1e'))!;
    assert.ok(contrastRatio(accent, parseColor('#1e1e1e')!) >= 3);
  });

  it('deriveAccent falls back to Swiss red for an unparseable seed', () => {
    assert.equal(deriveAccent('garbage', '#1e1e1e', '#e5231b'), '#e5231b');
  });

  it('toHex round-trips a parsed colour', () => {
    assert.equal(toHex(parseColor('#abcdef')!), '#abcdef');
  });
});
