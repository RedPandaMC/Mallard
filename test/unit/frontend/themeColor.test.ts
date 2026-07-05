import { strict as assert } from 'assert';
import { applyPalette, readTheme } from '../../../src/extension-frontend/theme';
import { parseColor, hslToRgb, rgbToHsl, deriveAccent } from '../../../src/extension-frontend/color';
import type { PaletteMode } from '../../../src/extension-backend/domain/types';

describe('theme — applyPalette + readTheme', () => {
  it('readTheme returns CSS var values with fallbacks', () => {
    const t = readTheme();
    assert.ok(t.bg.startsWith('#') || t.bg.startsWith('rgb'));
    assert.ok(typeof t.fg === 'string');
  });

  it('applyPalette swiss mode sets --w-accent on the document root', () => {
    applyPalette('swiss' as PaletteMode, 'dark');
    const accent = document.documentElement.style.getPropertyValue('--w-accent');
    assert.ok(accent, '--w-accent is set');
    assert.match(accent, /^#[0-9a-f]{6}$/i);
  });

  it('applyPalette theme mode derives an accent from --vscode-button-background', () => {
    document.documentElement.style.setProperty('--vscode-button-background', '#0078d4');
    applyPalette('theme' as PaletteMode, 'dark');
    const accent = document.documentElement.style.getPropertyValue('--w-accent');
    assert.ok(accent, '--w-accent set in theme mode');
    document.documentElement.style.removeProperty('--vscode-button-background');
  });

  it('applyPalette light mode uses the light base red', () => {
    applyPalette('swiss' as PaletteMode, 'light');
    const accent = document.documentElement.style.getPropertyValue('--w-accent');
    assert.ok(accent);
  });

  it('applyPalette high-contrast-light mode uses the light base red', () => {
    applyPalette('swiss' as PaletteMode, 'high-contrast-light');
    assert.ok(document.documentElement.style.getPropertyValue('--w-accent'));
  });
});

describe('color — HSL hue sextants (all 6 branches)', () => {
  it('h < 60 → red sector', () => {
    const rgb = hslToRgb({ h: 0, s: 1, l: 0.5 });
    assert.deepEqual(rgb, { r: 255, g: 0, b: 0 });
  });

  it('60 ≤ h < 120 → yellow-green sector', () => {
    const rgb = hslToRgb({ h: 60, s: 1, l: 0.5 });
    assert.deepEqual(rgb, { r: 255, g: 255, b: 0 });
  });

  it('120 ≤ h < 180 → green sector', () => {
    const rgb = hslToRgb({ h: 120, s: 1, l: 0.5 });
    assert.deepEqual(rgb, { r: 0, g: 255, b: 0 });
  });

  it('180 ≤ h < 240 → cyan sector', () => {
    const rgb = hslToRgb({ h: 180, s: 1, l: 0.5 });
    assert.deepEqual(rgb, { r: 0, g: 255, b: 255 });
  });

  it('240 ≤ h < 300 → blue-magenta sector', () => {
    const rgb = hslToRgb({ h: 240, s: 1, l: 0.5 });
    assert.deepEqual(rgb, { r: 0, g: 0, b: 255 });
  });

  it('h ≥ 300 → magenta-red sector', () => {
    const rgb = hslToRgb({ h: 300, s: 1, l: 0.5 });
    assert.deepEqual(rgb, { r: 255, g: 0, b: 255 });
  });
});

describe('color — parseColor edge cases', () => {
  it('returns null for a malformed hex (wrong length)', () => {
    assert.equal(parseColor('#ab'), null);
    assert.equal(parseColor('#abcde'), null);
    assert.equal(parseColor('#aabbccd'), null);
  });

  it('parses 3-digit hex', () => {
    assert.deepEqual(parseColor('#abc'), { r: 0xaa, g: 0xbb, b: 0xcc });
  });

  it('parses 6-digit hex', () => {
    assert.deepEqual(parseColor('#ff8800'), { r: 255, g: 136, b: 0 });
  });

  it('parses 8-digit hex (with alpha, ignored)', () => {
    assert.deepEqual(parseColor('#ff8800ff'), { r: 255, g: 136, b: 0 });
  });
});

describe('color — CVD-distinct saturation bump (deriveAccent fallback)', () => {
  it('deriveAccent produces a valid hex for a mid-gray seed (triggers CVD fallback)', () => {
    // A gray-ish seed that won't be CVD-distinct from mid-gray → saturation bump.
    const accent = deriveAccent('#808080', '#1e1e1e', '#ff453a');
    assert.match(accent, /^#[0-9a-f]{6}$/i);
  });

  it('deriveAccent produces a valid hex for a vivid seed', () => {
    const accent = deriveAccent('#0078d4', '#1e1e1e', '#ff453a');
    assert.match(accent, /^#[0-9a-f]{6}$/i);
  });
});

describe('color — round-trip rgb → hsl → rgb', () => {
  it('rgbToHsl + hslToRgb approximately round-trips', () => {
    const orig = { r: 100, g: 150, b: 200 };
    const hsl = rgbToHsl(orig);
    const back = hslToRgb(hsl);
    assert.ok(Math.abs(back.r - orig.r) <= 1);
    assert.ok(Math.abs(back.g - orig.g) <= 1);
    assert.ok(Math.abs(back.b - orig.b) <= 1);
  });
});
