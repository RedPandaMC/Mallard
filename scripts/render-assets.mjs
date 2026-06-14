// Renders all Weevil brand raster assets from the source SVG art.
//
// Source of truth: docs/public/logo.svg (the gradient weevil mark) and the
// codicon SVGs shipped in @vscode/codicons. Outputs are committed binaries, so
// this only needs to run when the art changes:  bun run assets
//
// Rasterisation uses @resvg/resvg-js (gradient-aware). Banner text is rendered
// with the brand fonts cached under scripts/.fontcache (downloaded once; see
// README in that folder). Everything degrades to system fonts if absent.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const r = (p) => join(root, p);

// --- fonts -----------------------------------------------------------------
const fontDir = r('scripts/.fontcache');
const fontFiles = ['Fraunces.ttf', 'JetBrainsMono.ttf']
  .map((f) => join(fontDir, f))
  .filter((f) => existsSync(f));

function render(svg, { width, height } = {}) {
  const fitTo = width
    ? { mode: 'width', value: width }
    : height
      ? { mode: 'height', value: height }
      : { mode: 'original' };
  const resvg = new Resvg(svg, {
    fitTo,
    font: { fontFiles, loadSystemFonts: true, defaultFontFamily: 'Fraunces' },
    background: 'rgba(0,0,0,0)',
  });
  return resvg.render().asPng();
}

function out(path, buf) {
  mkdirSync(dirname(r(path)), { recursive: true });
  writeFileSync(r(path), buf);
  console.log('  •', path, `(${(buf.length / 1024).toFixed(1)} kB)`);
}

// --- the weevil mark (gradient), as reusable inner markup ------------------
const logoSvg = readFileSync(r('docs/public/logo.svg'), 'utf8');
const weevilInner = logoSvg
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '');

// =========================================================================
// 1. Marketplace / app icon PNGs
// =========================================================================
console.log('icons');
for (const size of [128, 256, 512]) {
  out(`media/weevil-icon-${size}.png`, render(logoSvg, { width: size }));
}

// =========================================================================
// 2. Favicon (svg + multi-size ico)
// =========================================================================
console.log('favicon');
writeFileSync(r('docs/public/favicon.svg'), logoSvg);
console.log('  •', 'docs/public/favicon.svg');

function ico(pngs) {
  // ICONDIR + entries that embed PNG payloads (modern .ico).
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
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([head, ...entries, ...pngs.map((p) => p.data)]);
}
out(
  'docs/public/favicon.ico',
  ico([16, 32, 48].map((size) => ({ size, data: render(logoSvg, { width: size }) }))),
);

// =========================================================================
// 3. Tinted codicons for the README (GitHub-safe <img> section markers)
// =========================================================================
console.log('codicons');
const codiconSrc = r('node_modules/@vscode/codicons/src/icons');
const INK = '#B45CFF';
const wantCodicons = [
  'graph',
  'pulse',
  'shield',
  'gear',
  'git-commit',
  'multiple-windows',
  'beaker',
  'telescope',
  'verified',
];
for (const name of wantCodicons) {
  const src = join(codiconSrc, `${name}.svg`);
  if (!existsSync(src)) {
    console.warn('  ! missing codicon', name);
    continue;
  }
  const tinted = Buffer.from(readFileSync(src, 'utf8').replace(/currentColor/g, INK));
  out(`media/brand/codicons/${name}.svg`, tinted); // README (repo-relative)
  out(`docs/public/brand/codicons/${name}.svg`, tinted); // docs site (served)
}

// =========================================================================
// 4. Social / hero banner — the "specimen plate" (dark + light)
// =========================================================================
console.log('banner');
const SERIF = "Fraunces, 'Liberation Serif', Georgia, serif";
const MONO = "'JetBrains Mono', 'DejaVu Sans Mono', monospace";

function banner({ bg, ink, muted, rule, frame, ht }) {
  const W = 1200;
  const H = 630;
  const m = 44; // frame inset
  const tick = (x, y) =>
    `<path d="M${x - 7} ${y}H${x + 7}M${x} ${y - 7}V${y + 7}" stroke="${frame}" stroke-width="1.4"/>`;
  const lead = (x1, y1, x2, y2) =>
    `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${muted}" stroke-width="1" fill="none"/><circle cx="${x1}" cy="${y1}" r="2.2" fill="${ink}"/>`;
  const label = (x, y, t, anchor = 'start') =>
    `<text x="${x}" y="${y}" font-family="${MONO}" font-size="15" letter-spacing="1.5" fill="${muted}" text-anchor="${anchor}">${t}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <pattern id="ht" width="6" height="6" patternUnits="userSpaceOnUse">
      <circle cx="1.2" cy="1.2" r="1" fill="${ht}"/>
    </pattern>
    <linearGradient id="rule-grad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#FFB454"/><stop offset="0.5" stop-color="#FF6B81"/><stop offset="1" stop-color="#B45CFF"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="${bg}"/>
  <rect width="${W}" height="${H}" fill="url(#ht)" opacity="0.05"/>
  <rect x="${m}" y="${m}" width="${W - 2 * m}" height="${H - 2 * m}" fill="none" stroke="${frame}" stroke-width="1.4"/>
  ${tick(m, m)}${tick(W - m, m)}${tick(m, H - m)}${tick(W - m, H - m)}

  <!-- catalogue header -->
  <text x="${m + 26}" y="${m + 40}" font-family="${MONO}" font-size="15" letter-spacing="3.5" fill="${muted}">FIELD SPECIMEN &#183; No.001</text>
  <text x="${W - m - 26}" y="${m + 40}" font-family="${SERIF}" font-style="italic" font-size="20" fill="${muted}" text-anchor="end">Curculionoidea copiloti</text>

  <!-- specimen mark -->
  <svg x="610" y="150" width="380" height="330" viewBox="0 0 2048 2048">${weevilInner}</svg>
  ${lead(745, 248, 690, 196)}${label(682, 191, 'rostrum &#183; live readout', 'end')}
  ${lead(885, 295, 1000, 268)}${label(1006, 273, 'elytra &#183; models')}
  ${lead(852, 392, 1000, 430)}${label(1006, 435, 'abdomen &#183; tokens')}

  <!-- wordmark -->
  <text x="${m + 26}" y="318" font-family="${SERIF}" font-size="168" font-weight="600" letter-spacing="-3" fill="${ink}">Weevil</text>
  <rect x="${m + 30}" y="346" width="120" height="3" fill="url(#rule-grad)"/>
  <text x="${m + 28}" y="392" font-family="${SERIF}" font-size="30" fill="${ink}">Know exactly what GitHub Copilot is costing you.</text>
  <text x="${m + 28}" y="430" font-family="${MONO}" font-size="15" letter-spacing="0.5" fill="${muted}">fig.1 &#8212; real-time spend, read from Copilot's local OTel logs &#183; no sign-in</text>

  <!-- footer metadata -->
  <line x1="${m + 26}" y1="${H - m - 38}" x2="${W - m - 26}" y2="${H - m - 38}" stroke="${rule}" stroke-width="1"/>
  <text x="${m + 26}" y="${H - m - 16}" font-family="${MONO}" font-size="14" letter-spacing="2" fill="${muted}">VS&#160;CODE&#160;EXTENSION &#160;&#183;&#160; DUCKDB &#160;&#183;&#160; LOCAL-FIRST &#160;&#183;&#160; MIT</text>
  <text x="${W - m - 26}" y="${H - m - 16}" font-family="${MONO}" font-size="14" letter-spacing="1" fill="${muted}" text-anchor="end">github.com/RedPandaMC/Weevil</text>
</svg>`;
}

const themes = {
  dark: {
    bg: '#16140F',
    ink: '#F3EAD9',
    muted: '#A89F8C',
    rule: 'rgba(243,234,217,0.20)',
    frame: 'rgba(243,234,217,0.34)',
    ht: '#F3EAD9',
  },
  light: {
    bg: '#F3EAD9',
    ink: '#2A241B',
    muted: '#6F6555',
    rule: 'rgba(42,36,27,0.20)',
    frame: 'rgba(42,36,27,0.38)',
    ht: '#2A241B',
  },
};
for (const [name, theme] of Object.entries(themes)) {
  const svg = banner(theme);
  const png = render(svg);
  out(`media/brand/og-${name}.svg`, Buffer.from(svg));
  out(`media/brand/og-${name}.png`, png);
  // also serve from the docs site so social scrapers can fetch an absolute URL
  out(`docs/public/brand/og-${name}.png`, png);
}

console.log('done.');
