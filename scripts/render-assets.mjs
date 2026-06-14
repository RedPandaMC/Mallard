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

const DATA = ['#2F9BE8', '#4FC23A', '#FFC400', '#FF453A']; // OP-Z primaries

function banner({ bg, ink, muted, frame }) {
  const W = 1200;
  const H = 630;
  const m = 44;
  const T = { blue: '#2F9BE8', green: '#4FC23A', yellow: '#FFC400', red: '#FF453A', gray: '#6A6A6A' };
  const tick = (x, y) =>
    `<path d="M${x - 7} ${y}H${x + 7}M${x} ${y - 7}V${y + 7}" stroke="${frame}" stroke-width="1.4"/>`;

  // OP-Z readout screen: pure-black OLED glass + big flat primary number
  const sc = (x, y, lab, val, c) => `
    <rect x="${x}" y="${y}" width="198" height="86" rx="8" fill="#000" stroke="${frame}"/>
    <text x="${x + 16}" y="${y + 28}" font-family="${MONO}" font-size="11" letter-spacing="2" fill="${T.gray}">${lab}</text>
    <text x="${x + 16}" y="${y + 68}" font-family="${GROTESK}" font-size="38" font-weight="700" letter-spacing="-1.5" fill="${c}">${val}</text>`;

  // OP-Z group chip (flat colour square + letter)
  const gc = (x, L, c) =>
    `<rect x="${x}" y="468" width="34" height="34" rx="6" fill="${c}"/><text x="${x + 17}" y="492" font-family="${GROTESK}" font-size="18" font-weight="700" fill="#000" text-anchor="middle">${L}</text>`;

  // flat ADSR "spend envelope"
  const by = 322;
  const env = `
    <polygon points="700,${by} 786,170 786,${by}" fill="${T.blue}"/>
    <polygon points="786,${by} 786,170 870,238 870,${by}" fill="${T.green}"/>
    <polygon points="870,${by} 870,238 1066,238 1066,${by}" fill="${T.yellow}"/>
    <polygon points="1066,${by} 1066,238 1150,${by}" fill="${T.red}"/>
    <line x1="700" y1="${by}" x2="1150" y2="${by}" stroke="${ink}" stroke-width="2"/>`;

  // 4-colour OP-Z bar
  const bar = ['blue', 'green', 'yellow', 'red']
    .map((k, i) => `<rect x="${m + 28 + i * 38}" y="298" width="38" height="4" fill="${T[k]}"/>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${bg}"/>
  <rect x="${m}" y="${m}" width="${W - 2 * m}" height="${H - 2 * m}" fill="none" stroke="${frame}" stroke-width="1.4"/>
  ${tick(m, m)}${tick(W - m, m)}${tick(m, H - m)}${tick(W - m, H - m)}

  <!-- header tags -->
  <text x="${m + 26}" y="${m + 38}" font-family="${MONO}" font-size="14" letter-spacing="3.5" fill="${muted}">COPILOT SPEND &#183; INSTRUMENT</text>
  <text x="${W - m - 26}" y="${m + 38}" font-family="${MONO}" font-size="14" letter-spacing="2" fill="${muted}" text-anchor="end">v0.2 &#183; MIT</text>

  <!-- weevil mark (the only gradient) + wordmark -->
  <svg x="${m + 22}" y="108" width="58" height="58" viewBox="0 0 2048 2048">${weevilInner}</svg>
  <text x="${m + 22}" y="270" font-family="${GROTESK}" font-size="118" font-weight="700" letter-spacing="-4" fill="${ink}">Weevil</text>
  ${bar}
  <text x="${m + 26}" y="344" font-family="${GROTESK}" font-size="26" font-weight="500" fill="${ink}">Know exactly what GitHub Copilot is costing you.</text>

  <!-- OP-Z readout screens -->
  ${sc(m + 26, 380, 'TODAY', '$4.20', T.blue)}
  ${sc(m + 236, 380, 'THIS MONTH', '$12.40', T.green)}

  <!-- group chips -->
  ${gc(m + 26, 'C', T.blue)}${gc(m + 66, 'I', T.green)}${gc(m + 106, 'A', T.yellow)}${gc(m + 146, 'E', T.red)}
  <text x="${m + 192}" y="490" font-family="${MONO}" font-size="13" letter-spacing="1.5" fill="${muted}">chat · inline · agent · edit</text>

  <!-- ADSR spend envelope -->
  <text x="700" y="150" font-family="${MONO}" font-size="13" letter-spacing="2" fill="${muted}">SPEND ENVELOPE · 30D</text>
  <text x="1150" y="150" font-family="${GROTESK}" font-size="26" font-weight="700" fill="${T.green}" text-anchor="end">38%</text>
  ${env}
  <text x="700" y="350" font-family="${MONO}" font-size="12" letter-spacing="2" fill="${T.gray}">PROJECTED $31.00 · ATTACK→RELEASE</text>

  <!-- footer metadata -->
  <line x1="${m + 26}" y1="${H - m - 38}" x2="${W - m - 26}" y2="${H - m - 38}" stroke="${frame}" stroke-width="1"/>
  <text x="${m + 26}" y="${H - m - 16}" font-family="${MONO}" font-size="14" letter-spacing="2" fill="${muted}">VS&#160;CODE &#160;&#183;&#160; DUCKDB &#160;&#183;&#160; LOCAL-FIRST &#160;&#183;&#160; NO&#160;SIGN-IN</text>
  <text x="${W - m - 26}" y="${H - m - 16}" font-family="${MONO}" font-size="14" letter-spacing="1" fill="${muted}" text-anchor="end">github.com/RedPandaMC/Weevil</text>
</svg>`;
}

const themes = {
  dark: {
    bg: '#000000',
    ink: '#ECEAE4',
    muted: '#7C7C7C',
    frame: 'rgba(255,255,255,0.16)',
  },
  light: {
    bg: '#ECEAE4',
    ink: '#15140F',
    muted: '#6B675C',
    frame: 'rgba(0,0,0,0.2)',
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
    isoPrism(150, baseY, 44, 64, 24, '#2F9BE8') +
    isoPrism(210, baseY, 44, 132, 24, '#4FC23A') +
    isoPrism(270, baseY, 44, 96, 24, '#FFC400') +
    isoPrism(330, baseY, 44, 48, 24, '#FF453A');
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
