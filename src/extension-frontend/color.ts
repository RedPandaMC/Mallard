/**
 * Small, dependency-free colour utilities used to keep BOTH palette modes
 * accessible: WCAG contrast, colour-vision-deficiency (CVD) simulation, and
 * the derivation of a theme-seeded accent that stays legible and distinct from
 * the grayscale ramp. All inputs may be hex or the rgb()/rgba() strings that
 * getComputedStyle returns.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Parse '#rgb', '#rrggbb', 'rgb(...)' or 'rgba(...)' → RGB (0–255), or null. */
export function parseColor(input: string): RGB | null {
  const s = input.trim();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0]! + hex[0], 16),
        g: parseInt(hex[1]! + hex[1], 16),
        b: parseInt(hex[2]! + hex[2], 16),
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
    return null;
  }
  const m = s.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const parts = m[1]!.split(/[,/\s]+/).filter(Boolean);
    if (parts.length >= 3) {
      const [r, g, b] = parts;
      return { r: clamp255(parseFloat(r!)), g: clamp255(parseFloat(g!)), b: clamp255(parseFloat(b!)) };
    }
  }
  return null;
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function toHex({ r, g, b }: RGB): string {
  const h = (n: number) => clamp255(n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** WCAG relative luminance (0–1). */
export function luminance({ r, g, b }: RGB): number {
  const lin = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio (1–21). */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE: RGB = { r: 255, g: 255, b: 255 };
const BLACK: RGB = { r: 0, g: 0, b: 0 };

/** Black or white, whichever has higher WCAG contrast on top of `bg`. Used to
 *  pick a legible foreground for a derived accent (a light/pastel accent needs
 *  black text, not the hardcoded white). */
export function readableForeground(bg: RGB): string {
  return contrastRatio(WHITE, bg) >= contrastRatio(BLACK, bg) ? '#ffffff' : '#000000';
}

// ── HSL conversions (for lightness/saturation nudging) ──────────────────────

export interface HSL {
  h: number; // 0–360
  s: number; // 0–1
  l: number; // 0–1
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: clamp255((r + m) * 255), g: clamp255((g + m) * 255), b: clamp255((b + m) * 255) };
}

// ── Colour-vision-deficiency simulation (Machado et al. 2009, severity 1) ───

type Matrix = [number, number, number, number, number, number, number, number, number];

const CVD: Record<'protan' | 'deuter' | 'tritan', Matrix> = {
  protan: [0.567, 0.433, 0.0, 0.558, 0.442, 0.0, 0.0, 0.242, 0.758],
  deuter: [0.625, 0.375, 0.0, 0.7, 0.3, 0.0, 0.0, 0.3, 0.7],
  tritan: [0.95, 0.05, 0.0, 0.0, 0.433, 0.567, 0.0, 0.475, 0.525],
};

export function simulateCvd(c: RGB, type: keyof typeof CVD): RGB {
  const m = CVD[type];
  return {
    r: clamp255(m[0] * c.r + m[1] * c.g + m[2] * c.b),
    g: clamp255(m[3] * c.r + m[4] * c.g + m[5] * c.b),
    b: clamp255(m[6] * c.r + m[7] * c.g + m[8] * c.b),
  };
}

function dist(a: RGB, b: RGB): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

/** Are two colours still distinguishable under all three CVD types? */
export function distinctUnderCvd(a: RGB, b: RGB, min = 38): boolean {
  return (['protan', 'deuter', 'tritan'] as const).every(
    (t) => dist(simulateCvd(a, t), simulateCvd(b, t)) >= min,
  );
}

/**
 * Nudge `color`'s lightness until it meets `minContrast` against `bg`, moving
 * away from the background's luminance. Returns the adjusted colour.
 */
export function ensureContrast(color: RGB, bg: RGB, minContrast = 3): RGB {
  if (contrastRatio(color, bg) >= minContrast) return color;
  const bgLight = luminance(bg) > 0.4;
  const hsl = rgbToHsl(color);
  for (let i = 0; i < 20; i++) {
    hsl.l = bgLight ? Math.max(0, hsl.l - 0.04) : Math.min(1, hsl.l + 0.04);
    const next = hslToRgb(hsl);
    if (contrastRatio(next, bg) >= minContrast) return next;
    if (hsl.l <= 0 || hsl.l >= 1) return next;
  }
  return hslToRgb(hsl);
}

/**
 * Derive an accessible accent from a theme seed colour against `bg`. Guarantees
 * a minimum saturation (so it reads as an accent and stays distinct from the
 * neutral grayscale ramp under CVD) and a minimum contrast vs the background.
 * Falls back to the fixed Swiss red if the seed cannot be parsed.
 */
export function deriveAccent(seed: string, bg: string, fallback = '#e5231b'): string {
  const seedRgb = parseColor(seed);
  const bgRgb = parseColor(bg) ?? { r: 24, g: 24, b: 24 };
  if (!seedRgb) return fallback;

  const hsl = rgbToHsl(seedRgb);
  // A near-gray seed can't carry an accent role; floor the saturation so it is
  // CVD-distinct from the neutral ramp.
  if (hsl.s < 0.45) hsl.s = 0.55;

  let accent = ensureContrast(hslToRgb(hsl), bgRgb, 3);

  // If still not distinct from a mid-gray under CVD, push saturation up once more.
  const midGray: RGB = { r: 130, g: 130, b: 130 };
  /* c8 ignore next 5 */
  if (!distinctUnderCvd(accent, midGray)) {
    const h2 = rgbToHsl(accent);
    h2.s = Math.min(1, h2.s + 0.2);
    accent = ensureContrast(hslToRgb(h2), bgRgb, 3);
  }
  return toHex(accent);
}
