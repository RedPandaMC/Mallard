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
const fontFiles = ['SchibstedGrotesk.ttf', 'JetBrainsMono.ttf']
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
    font: { fontFiles, loadSystemFonts: true, defaultFontFamily: 'Schibsted Grotesk' },
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
// 4. Social / hero banner — the instrument schematic (dark + light)
// =========================================================================
console.log('banner');
const GROTESK = "'Schibsted Grotesk', 'Liberation Sans', Arial, sans-serif";
const MONO = "'JetBrains Mono', 'DejaVu Sans Mono', monospace";

const DATA = ['#FFB454', '#FF6B81', '#B45CFF', '#36C5D4'];

function banner({ bg, ink, muted, grid, frame, screen }) {
  const W = 1200;
  const H = 630;
  const m = 44;
  const tick = (x, y) =>
    `<path d="M${x - 7} ${y}H${x + 7}M${x} ${y - 7}V${y + 7}" stroke="${frame}" stroke-width="1.4"/>`;
  const lead = (x1, y1, x2, y2, c) =>
    `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${muted}" stroke-width="1" fill="none"/><circle cx="${x1}" cy="${y1}" r="3" fill="none" stroke="${c}" stroke-width="2"/>`;
  const label = (x, y, t, anchor = 'start') =>
    `<text x="${x}" y="${y}" font-family="${MONO}" font-size="14" letter-spacing="1.2" fill="${muted}" text-anchor="${anchor}">${t}</text>`;

  // mini OP-Z readout chip
  const chip = (x, y, lab, val, accent) => `
    <rect x="${x}" y="${y}" width="172" height="64" rx="6" fill="${screen}" stroke="${frame}"/>
    <rect x="${x}" y="${y}" width="172" height="64" rx="6" fill="url(#scr)"/>
    <text x="${x + 14}" y="${y + 22}" font-family="${MONO}" font-size="11" letter-spacing="2" fill="${muted}">${lab}</text>
    <text x="${x + 14}" y="${y + 50}" font-family="${MONO}" font-size="24" font-weight="700" fill="${accent}">${val}</text>`;

  // ruler tick strip
  let ruler = '';
  for (let i = 0; i <= 26; i++) {
    const x = 700 + i * 15;
    const tall = i % 5 === 0;
    ruler += `<line x1="${x}" y1="492" x2="${x}" y2="${tall ? 504 : 499}" stroke="${muted}" stroke-width="${tall ? 1.6 : 1}"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0H0V40" fill="none" stroke="${grid}" stroke-width="1"/>
    </pattern>
    <pattern id="scr" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.6" fill="rgba(255,255,255,0.06)"/></pattern>
    <linearGradient id="rule-grad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#FFB454"/><stop offset="0.5" stop-color="#FF6B81"/><stop offset="1" stop-color="#B45CFF"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="${bg}"/>
  <rect width="${W}" height="${H}" fill="url(#grid)" opacity="0.6"/>
  <rect x="${m}" y="${m}" width="${W - 2 * m}" height="${H - 2 * m}" fill="none" stroke="${frame}" stroke-width="1.4"/>
  ${tick(m, m)}${tick(W - m, m)}${tick(m, H - m)}${tick(W - m, H - m)}

  <!-- header tags -->
  <text x="${m + 26}" y="${m + 40}" font-family="${MONO}" font-size="14" letter-spacing="3.5" fill="${muted}">COPILOT SPEND &#183; INSTRUMENT</text>
  <text x="${W - m - 26}" y="${m + 40}" font-family="${MONO}" font-size="14" letter-spacing="2" fill="${muted}" text-anchor="end">v0.2 &#183; MIT</text>

  <!-- schematic weevil + technical callouts + bracket -->
  <svg x="690" y="150" width="360" height="300" viewBox="0 0 2048 2048">${weevilInner}</svg>
  <path d="M676 168 h-14 v14 M1064 168 h14 v14 M676 452 h-14 v-14 M1064 452 h14 v-14" fill="none" stroke="${frame}" stroke-width="1.4"/>
  ${lead(810, 258, 752, 198, DATA[0])}${label(744, 193, 'live readout', 'end')}
  ${lead(958, 300, 1052, 270, DATA[2])}${label(1058, 275, 'model mix')}
  ${lead(922, 392, 1052, 432, DATA[1])}${label(1058, 437, 'token cost')}
  ${ruler}

  <!-- wordmark -->
  <text x="${m + 24}" y="306" font-family="${GROTESK}" font-size="150" font-weight="700" letter-spacing="-5" fill="${ink}">Weevil</text>
  <rect x="${m + 28}" y="338" width="132" height="4" fill="url(#rule-grad)"/>
  <text x="${m + 26}" y="384" font-family="${GROTESK}" font-size="28" font-weight="500" fill="${ink}">Know exactly what GitHub Copilot is costing you.</text>

  <!-- readout chips -->
  ${chip(m + 26, 414, 'TODAY', '$4.20', DATA[0])}
  ${chip(m + 214, 414, 'THIS MONTH', '$12.40', DATA[1])}
  ${chip(m + 402, 414, 'PROJECTED', '$31.00', DATA[2])}

  <!-- footer metadata -->
  <line x1="${m + 26}" y1="${H - m - 38}" x2="${W - m - 26}" y2="${H - m - 38}" stroke="${grid}" stroke-width="1"/>
  <text x="${m + 26}" y="${H - m - 16}" font-family="${MONO}" font-size="14" letter-spacing="2" fill="${muted}">VS&#160;CODE &#160;&#183;&#160; DUCKDB &#160;&#183;&#160; LOCAL-FIRST &#160;&#183;&#160; NO&#160;SIGN-IN</text>
  <text x="${W - m - 26}" y="${H - m - 16}" font-family="${MONO}" font-size="14" letter-spacing="1" fill="${muted}" text-anchor="end">github.com/RedPandaMC/Weevil</text>
</svg>`;
}

const themes = {
  dark: {
    bg: '#100F0C',
    ink: '#ECEAE4',
    muted: '#8C887E',
    grid: 'rgba(236,234,228,0.06)',
    frame: 'rgba(236,234,228,0.30)',
    screen: '#15131b',
  },
  light: {
    bg: '#ECEAE4',
    ink: '#19180F',
    muted: '#6B675C',
    grid: 'rgba(25,24,15,0.06)',
    frame: 'rgba(25,24,15,0.32)',
    screen: '#1a1822',
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

// =========================================================================
// 5. Field-kit patch — geometric 3D-wireframe instrument badge
//    (embroidered-patch / X+Y axis-plot / ruler-baseline language)
// =========================================================================
console.log('patch');
function isoPrism(x, baseY, w, h, depth, color) {
  const dx = depth * 0.72;
  const dy = -depth * 0.5;
  const ft = baseY - h;
  const fr = x + w;
  return `<g fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <rect x="${x}" y="${ft}" width="${w}" height="${h}"/>
    <path d="M${x} ${ft} L${x + dx} ${ft + dy} L${x + dx + w} ${ft + dy} L${fr} ${ft} Z"/>
    <path d="M${fr} ${ft} L${fr + dx} ${ft + dy} L${fr + dx} ${baseY + dy} L${fr} ${baseY} Z"/>
  </g>`;
}
function patch() {
  const S = 512;
  const paper = '#F3EAD9';
  const muted = 'rgba(243,234,217,0.45)';
  const line = 'rgba(243,234,217,0.7)';
  const baseY = 352;
  const prisms =
    isoPrism(150, baseY, 44, 64, 24, '#FFB454') +
    isoPrism(210, baseY, 44, 132, 24, '#FF6B81') +
    isoPrism(270, baseY, 44, 96, 24, '#B45CFF') +
    isoPrism(330, baseY, 44, 48, 24, '#36C5D4');
  // ruler ticks along the baseline
  let ticks = '';
  for (let i = 0; i <= 13; i++) {
    const x = 132 + i * 20;
    const tall = i % 5 === 0;
    ticks += `<line x1="${x}" y1="${baseY + 18}" x2="${x}" y2="${baseY + (tall ? 32 : 26)}" stroke="${muted}" stroke-width="${tall ? 2 : 1}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <pattern id="pht" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.7" fill="${paper}"/></pattern>
  </defs>
  <rect x="6" y="6" width="${S - 12}" height="${S - 12}" rx="34" fill="#16140F"/>
  <rect x="6" y="6" width="${S - 12}" height="${S - 12}" rx="34" fill="url(#pht)" opacity="0.05"/>
  <rect x="18" y="18" width="${S - 36}" height="${S - 36}" rx="26" fill="none" stroke="${paper}" stroke-opacity="0.35" stroke-width="2"/>
  <rect x="28" y="28" width="${S - 56}" height="${S - 56}" rx="20" fill="none" stroke="${paper}" stroke-opacity="0.2" stroke-width="1" stroke-dasharray="2 4"/>

  <text x="52" y="74" font-family="${MONO}" font-size="15" letter-spacing="4" fill="${muted}">FIELD KIT</text>
  <text x="${S - 52}" y="74" font-family="${MONO}" font-size="15" letter-spacing="2" fill="${muted}" text-anchor="end">No.001</text>
  <text x="52" y="118" font-family="${GROTESK}" font-size="19" letter-spacing="2" fill="${line}">x + y</text>

  <!-- axes -->
  <line x1="120" y1="${baseY}" x2="404" y2="${baseY}" stroke="${line}" stroke-width="2"/>
  <line x1="132" y1="150" x2="132" y2="${baseY}" stroke="${line}" stroke-width="2"/>
  ${prisms}
  ${ticks}

  <text x="${S / 2}" y="${S - 40}" font-family="${MONO}" font-size="16" letter-spacing="6" fill="${paper}" text-anchor="middle">WEEVIL</text>
</svg>`;
  return svg;
}
{
  const svg = patch();
  const png = render(svg, { width: 512 });
  out('media/brand/patch.svg', Buffer.from(svg));
  out('media/brand/patch.png', png);
  out('docs/public/brand/patch.png', png);
}

console.log('done.');
