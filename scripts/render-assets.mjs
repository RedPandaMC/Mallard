// Renders all Mallard brand raster assets (duck mark) from the canonical SVG
// paths below. Outputs are committed binaries, so this only runs when the art
// changes:  bun run assets
//
// Rasterisation uses @resvg/resvg-js.
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const r = (p) => join(root, p);

function render(svg, { width } = {}) {
  const resvg = new Resvg(svg, {
    fitTo: width ? { mode: 'width', value: width } : { mode: 'original' },
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
// monochrome silhouette with cutout eye (activity bar — VS Code applies theme colour)
const duckMono = (c) =>
  `<defs><mask id="m"><rect width="490" height="491" fill="white"/><path d="${DUCK.eye}" fill="black"/></mask></defs>` +
  `<g mask="url(#m)"><path d="${DUCK.wing}" fill="${c}"/><path d="${DUCK.body}" fill="${c}"/><path d="${DUCK.head}" fill="${c}"/></g>`;
// duck with eye punched out as a transparent cutout (mask subtracts eye from white group)
const duckCutout = (fg) =>
  `<defs><mask id="m"><rect width="490" height="491" fill="white"/><path d="${DUCK.eye}" fill="black"/></mask></defs>` +
  `<g mask="url(#m)"><path d="${DUCK.wing}" fill="${fg}"/><path d="${DUCK.body}" fill="${fg}"/><path d="${DUCK.head}" fill="${fg}"/></g>`;

// =========================================================================
// 1. App / marketplace icon — black tile + white duck + cutout eye
// =========================================================================
function appIconSvg() {
  const pad = 96;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#0A0A0A"/>
  <svg x="${pad}" y="${pad}" width="${512 - 2 * pad}" height="${512 - 2 * pad}" viewBox="0 0 490 491">${duckCutout('#FFFFFF')}</svg>
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
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="-10 -10 510 511" fill="currentColor">${duckMono('currentColor')}</svg>`,
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

console.log('done.');
