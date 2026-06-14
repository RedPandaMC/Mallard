# scripts

## render-assets.mjs

Regenerates every committed brand raster from the source SVG art
(`docs/public/logo.svg`) and the codicon set. Run after changing the art:

```bash
bun run assets
```

Outputs (all committed): `media/weevil-icon-{128,256,512}.png`,
`media/brand/og-{dark,light}.{svg,png}`, `media/brand/patch.{svg,png}`,
`media/brand/codicons/*.svg`, `docs/public/favicon.{svg,ico}`.

### Fonts

Banner/patch text uses the brand fonts (Schibsted Grotesk + JetBrains Mono). The
script reads TTFs from `scripts/.fontcache/` (git-ignored); if missing it falls
back to system fonts. To restore the cache:

```bash
mkdir -p scripts/.fontcache
curl -sSL -o scripts/.fontcache/SchibstedGrotesk.ttf \
  'https://github.com/google/fonts/raw/main/ofl/schibstedgrotesk/SchibstedGrotesk%5Bwght%5D.ttf'
curl -sSL -o scripts/.fontcache/JetBrainsMono.ttf \
  'https://github.com/google/fonts/raw/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf'
```

The web `.woff2` files under `docs/public/fonts/` are the same faces (OFL),
converted with `fonttools`.
