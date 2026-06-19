// Renders all Mallard brand raster assets (duck mark) from the canonical SVG
// paths below. Outputs are committed binaries, so this only runs when the art
// changes:  bun run assets
//
// Rasterisation uses @resvg/resvg-js. Text (OG banner) uses the brand fonts
// cached under scripts/.fontcache (see scripts/README.md to restore them).
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const r = (p) => join(root, p);

const fontDir = r('scripts/.fontcache');
const fontFiles = ['Archivo-Heavy.ttf', 'HankenGrotesk.ttf', 'IBMPlexMono-Regular.ttf']
  .map((f) => join(fontDir, f))
  .filter(existsSync);

function render(svg, { width } = {}) {
  const resvg = new Resvg(svg, {
    fitTo: width ? { mode: 'width', value: width } : { mode: 'original' },
    font: { fontFiles, loadSystemFonts: true, defaultFontFamily: 'Archivo' },
    background: 'rgba(0,0,0,0)',
  });
  return resvg.render().asPng();
}
function out(path, buf) {
  mkdirSync(dirname(r(path)), { recursive: true });
  writeFileSync(r(path), buf);
  console.log('  •', path, `(${(buf.length / 1024).toFixed(1)} kB)`);
}

// --- the mallard duck, as path data (viewBox 0 0 490 491) ------------------
const DUCK = {
  head: 'M376.57,141.50 C400.83,164.97 429.17,187.34 476.34,187.42 C486.83,191.21 488.70,200.40 488.11,214.28 C486.14,225.44 451.49,229.82 436.75,230.49 C427.23,230.92 334.63,229.96 333.75,229.25 C333.06,228.69 333.72,228.14 333.75,228.10 C359.74,210.92 375.91,183.82 376.57,141.50 Z',
  body: 'M337.75,490.92 L228.75,490.97 C313.83,448.76 293.14,315.53 207.00,291.04 L207.01,146.25 C211.57,46.43 334.43,38.09 356.05,121.03 C366.56,161.34 348.45,195.98 325.35,212.75 C322.71,214.66 307.17,222.42 306.40,225.59 C304.60,233.02 339.68,297.10 344.66,306.75 C381.72,371.24 410.52,437.51 337.75,490.92 Z',
  wing: 'M-0.00,374.50 L-0.00,294.50 L168.75,294.50 C233.93,300.98 260.17,382.52 210.95,426.43 C163.42,465.13 99.11,431.86 88.63,381.25 C59.42,382.53 22.91,383.36 -0.00,374.50 Z',
  eye: 'M305.97,120.56 C324.53,134.97 308.57,164.98 285.47,151.47 C269.05,137.87 283.12,110.17 305.97,120.56 Z',
};
// flat duotone duck: silhouette in `fg`, eye in `eye`
const duckFlat = (fg, eye) =>
  `<path d="${DUCK.wing}" fill="${fg}"/><path d="${DUCK.body}" fill="${fg}"/><path d="${DUCK.head}" fill="${fg}"/><path d="${DUCK.eye}" fill="${eye}"/>`;
// monochrome silhouette (activity bar — masked by VS Code to theme colour)
const duckMono = (c) =>
  `<path d="${DUCK.wing}" fill="${c}"/><path d="${DUCK.body}" fill="${c}"/><path d="${DUCK.head}" fill="${c}"/>`;

// =========================================================================
// 1. App / marketplace icon — black tile + white duck + red eye (duotone)
// =========================================================================
const RED = '#E5231B';
function appIconSvg() {
  const pad = 96;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#0A0A0A"/>
  <svg x="${pad}" y="${pad}" width="${512 - 2 * pad}" height="${512 - 2 * pad}" viewBox="0 0 490 491">${duckFlat('#FFFFFF', RED)}</svg>
</svg>`;
}
const iconSvg = appIconSvg();

console.log('icon');
out('media/brand/icon.svg', Buffer.from(iconSvg));
out('docs/public/icon.svg', Buffer.from(iconSvg));
out('docs/public/logo.svg', Buffer.from(iconSvg));
for (const size of [128, 256, 512]) out(`media/mallard-icon-${size}.png`, render(iconSvg, { width: size }));

// activity-bar icon: monochrome duck, currentColor (no tile)
console.log('activity-bar icon');
out(
  'media/mallard-icon.svg',
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="-30 -30 550 551" fill="currentColor">${duckMono('currentColor')}</svg>`,
  ),
);

// =========================================================================
// 2. Favicon (svg + multi-size ico)
// =========================================================================
console.log('favicon');
writeFileSync(r('docs/public/favicon.svg'), iconSvg);
console.log('  •', 'docs/public/favicon.svg');
function ico(pngs) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + pngs.length * 16;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([head, ...entries, ...pngs.map((p) => p.data)]);
}
out('docs/public/favicon.ico', ico([16, 32, 48].map((size) => ({ size, data: render(iconSvg, { width: size }) }))));

// =========================================================================
// 3. Social / OG banner — Swiss duotone (dark + light)
// =========================================================================
console.log('banner');
const ARCHIVO = "'Archivo', 'Liberation Sans', Arial, sans-serif";
const MONO = "'IBM Plex Mono', 'DejaVu Sans Mono', monospace";
const HANKEN = "'Hanken Grotesk', 'Liberation Sans', Arial, sans-serif";

function banner({ bg, fg, mut, mut2, line, accent }) {
  const W = 1200,
    H = 630,
    m = 56;
  // duotone "this month" summary card on the right
  const card = `
    <g font-family="${MONO}">
      <line x1="720" y1="150" x2="${W - m}" y2="150" stroke="${fg}" stroke-width="1.5"/>
      <text x="720" y="142" font-size="13" letter-spacing="2" fill="${mut}">THIS MONTH</text>
      <text x="${W - m}" y="142" font-size="13" letter-spacing="1" fill="${accent}" text-anchor="end">● LIVE</text>
      <text x="720" y="232" font-family="${ARCHIVO}" font-weight="800" font-size="78" letter-spacing="-2" fill="${fg}">$38.56</text>
      <text x="720" y="262" font-family="${HANKEN}" font-size="15" fill="${mut2}">4,820 credits · 62% of $50 budget</text>
      <rect x="720" y="284" width="424" height="13" fill="none" stroke="${line}"/>
      <rect x="720" y="284" width="212" height="13" fill="${fg}"/>
      <rect x="932" y="284" width="51" height="13" fill="${accent}"/>
      <g font-size="13.5">
        <line x1="720" y1="338" x2="${W - m}" y2="338" stroke="${line}"/>
        <text x="720" y="364" fill="${mut}">Today</text><text x="${W - m}" y="364" fill="${fg}" text-anchor="end">$6.42</text>
        <line x1="720" y1="382" x2="${W - m}" y2="382" stroke="${line}"/>
        <text x="720" y="408" fill="${mut}">Projected</text><text x="${W - m}" y="408" fill="${accent}" text-anchor="end">$61.40</text>
        <line x1="720" y1="426" x2="${W - m}" y2="426" stroke="${line}"/>
        <text x="720" y="452" fill="${mut}">Top model</text><text x="${W - m}" y="452" fill="${fg}" text-anchor="end">sonnet-4.5</text>
        <line x1="720" y1="470" x2="${W - m}" y2="470" stroke="${line}"/>
      </g>
    </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${bg}"/>
  <rect x="${m}" y="${m}" width="${W - 2 * m}" height="${H - 2 * m}" fill="none" stroke="${line}"/>
  <line x1="660" y1="${m}" x2="660" y2="${H - m}" stroke="${line}"/>

  <!-- wordmark -->
  <svg x="${m + 24}" y="${m + 22}" width="60" height="60" viewBox="0 0 512 512"><rect width="512" height="512" rx="120" fill="#0A0A0A"/><svg x="96" y="96" width="320" height="320" viewBox="0 0 490 491">${duckFlat('#FFFFFF', accent)}</svg></svg>
  <text x="${m + 100}" y="${m + 66}" font-family="${ARCHIVO}" font-weight="800" font-size="34" letter-spacing="1" fill="${fg}">MALLARD</text>

  <!-- eyebrow -->
  <g font-family="${MONO}" font-size="13" letter-spacing="3">
    <text x="${m + 24}" y="270" fill="${accent}" font-weight="600">01</text>
    <line x1="${m + 52}" y1="265" x2="${m + 84}" y2="265" stroke="${fg}"/>
    <text x="${m + 96}" y="270" fill="${mut}">COPILOT SPEND TRACKER · VS CODE</text>
  </g>

  <!-- headline -->
  <text x="${m + 22}" y="356" font-family="${ARCHIVO}" font-weight="800" font-size="66" letter-spacing="-2" fill="${fg}">Get your Copilot</text>
  <text x="${m + 22}" y="424" font-family="${ARCHIVO}" font-weight="800" font-size="66" letter-spacing="-2" fill="${fg}">spend all in a <tspan fill="${accent}">row.</tspan></text>
  <text x="${m + 24}" y="466" font-family="${HANKEN}" font-size="17" fill="${mut2}">Reads Copilot's local logs · live dashboard · no sign-in.</text>

  ${card}

  <!-- footer -->
  <text x="${m + 24}" y="${H - m - 18}" font-family="${MONO}" font-size="12.5" letter-spacing="2" fill="${mut}">MALLARD · v2.0 · BUILT FOR VS CODE · MIT</text>
  <text x="${W - m - 24}" y="${H - m - 18}" font-family="${MONO}" font-size="12.5" letter-spacing="1" fill="${mut}" text-anchor="end">github.com/RedPandaMC/Mallard</text>
</svg>`;
}

const themes = {
  dark: { bg: '#0A0A0A', fg: '#FFFFFF', mut: '#8C8C8C', mut2: '#C9C9C9', line: 'rgba(255,255,255,0.18)', accent: '#FF453A' },
  light: { bg: '#FFFFFF', fg: '#111111', mut: '#767676', mut2: '#3A3A3A', line: 'rgba(0,0,0,0.16)', accent: '#E5231B' },
};
for (const [name, t] of Object.entries(themes)) {
  const svg = banner(t);
  const png = render(svg);
  out(`media/brand/og-${name}.svg`, Buffer.from(svg));
  out(`media/brand/og-${name}.png`, png);
  out(`docs/public/brand/og-${name}.png`, png);
}

console.log('done.');
