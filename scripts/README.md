# scripts

## render-assets.mjs

Regenerates every committed Mallard brand raster from the canonical duck SVG
paths in the script. Run after changing the art:

```bash
bun run assets
```

Outputs (all committed): the app/marketplace icon `media/mallard-icon-{128,256,512}.png`,
the monochrome activity-bar icon `media/mallard-icon.svg`, `docs/public/{icon,logo,favicon}.svg`
+ `favicon.ico`, and the Swiss-duotone social banners `media/brand/og-{dark,light}.{svg,png}`
(also copied to `docs/public/brand/`).

### Fonts

Banner text uses the brand fonts (Archivo + Hanken Grotesk + IBM Plex Mono). The
script reads TTFs from `scripts/.fontcache/` (git-ignored); if missing it falls
back to system fonts. To restore the cache:

```bash
mkdir -p scripts/.fontcache
curl -sSL -o scripts/.fontcache/Archivo.ttf \
  'https://github.com/google/fonts/raw/main/ofl/archivo/Archivo%5Bwdth%2Cwght%5D.ttf'
curl -sSL -o scripts/.fontcache/HankenGrotesk.ttf \
  'https://github.com/google/fonts/raw/main/ofl/hankengrotesk/HankenGrotesk%5Bwght%5D.ttf'
curl -sSL -o scripts/.fontcache/IBMPlexMono-Regular.ttf \
  'https://github.com/google/fonts/raw/main/ofl/ibmplexmono/IBMPlexMono-Regular.ttf'
```

A static heavy Archivo (`Archivo-Heavy.ttf`, wght 800) is instanced from the
variable TTF for resvg text rendering. The web `.woff2` files under
`docs/public/fonts/` are the same faces (OFL), converted with `fonttools`.
