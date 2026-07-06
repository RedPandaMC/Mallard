# Mallard Webview (extension-frontend)

The dashboard UI that runs inside VS Code's webview sandbox: the activity-bar sidebar panel and the pop-out editor-tab dashboard. Bundled separately from the extension host in `../extension-backend` and communicates with it only through `postMessage`.

## Stack

Vanilla TypeScript and direct DOM manipulation, no JSX or component framework. State lives in a small Zustand store (`store.ts`); charts are rendered with Apache ECharts.

## Structure

```
extension-frontend/
├── main.ts        entry point: mounts the dashboard, wires message routing
├── api.ts         acquireVsCodeApi() wrapper, typed postMessage in/out
├── store.ts       Zustand store for snapshot/config/layout/filter state
├── theme.ts       palette resolution (swiss vs. VS Code theme)
├── color.ts       duotone colour ramp helpers
├── layout.ts      drag/resize/dock logic for the charts grid
├── lazyMount.ts   IntersectionObserver-based lazy chart mounting
├── chartDiff.ts   shallow-diff helpers so charts skip redundant re-renders
├── charts/        one file per chart, each extending ChartComponent
├── components/    KPI cards, filter bar, gauge, banners, panels
├── styles/        theme.css, dashboard.css, reset.css, fonts.css
└── fonts/         bundled woff2 files (Archivo, Hanken Grotesk, IBM Plex Mono)
```

## Entry point

`main.ts` imports the stylesheets, mounts the dashboard into `#app`, subscribes to inbound host messages via `api.ts`, and sends `{ type: 'ready' }` once mounted. All chart mounts happen lazily through `lazyChart()` (`lazyMount.ts`), so charts below the fold don't initialise until scrolled into view.

## Charts

Every chart in `charts/` extends the shared `ChartComponent` base class (`charts/ChartComponent.ts`), which owns the ECharts instance lifecycle and theme application:

| File | Chart |
| --- | --- |
| `dailyBars.ts` | 30-day daily spend bar chart with a projected-pace line |
| `heatmap.ts` | Calendar heatmap, last 12 weeks of activity |
| `modelBreakdown.ts` | Horizontal bar chart of top models, click to focus |
| `sankey.ts` | Flow chart from model to surface |
| `categoryBreakdown.ts` | Spend by cost type (input/output/tool/etc.) |
| `cumulativeArea.ts` | Cumulative spend over the current month |
| `weekdayRadial.ts` | Usage by day of week |
| `hourlyTimeline.ts` | Usage by hour of day |
| `echarts.ts` | Shared ECharts init, theme registration, and type re-exports |

## Components

`components/` holds the non-chart UI pieces, each a `mount*()` function that renders into a container element and returns an `update()` handle:

- `KpiCards.ts`: today / month-to-date / projected / top-model cards
- `FilterBar.ts`: date-range presets, metric toggle, model and surface filters
- `StatusBanner.ts`: ingest status (loading / ok / empty / error)
- `RestrictionBanner.ts`: active Copilot restriction state
- `GitHubBillingStrip.ts`: GitHub billing reconciliation summary
- `EmptyState.ts`: no-data placeholder
- `AlertConfigPanel.ts`: `config.json` editor entry point
- `CurrencySelector.ts`: display-currency dropdown

## Host communication

`api.ts` calls `acquireVsCodeApi()` once and exposes `post()` for outbound messages and `onMessage()` for inbound ones. Every inbound message is checked against `e.origin.startsWith('vscode-webview://')` before being handled, and validated with `isWebviewBoundMsg()`. Message shapes (`HostBoundMsg`, `WebviewBoundMsg`) are defined once in `../extension-backend/ui/messaging.ts` and imported by both sides, so host and webview can't drift out of sync.

## Styling

Plain CSS, no Tailwind or CSS modules. `styles/theme.css` defines VS Code-aware custom properties (`--w-bg`, `--w-fg`, `--w-accent`, spacing scale, severity colours); `styles/dashboard.css` lays out the grid, panels, and header. Two palettes are supported: `swiss` (fixed Cinnabar-red duotone) and `theme` (accent derived from the active VS Code colour theme), both checked for contrast. Fonts are bundled as woff2 and loaded via `styles/fonts.css`.

## Build

Bundled together with the extension host by esbuild (`esbuild.mjs` at the repo root), entry point `main.ts`, output `dist/webview/main.js` as an IIFE:

```bash
bun run compile   # one-shot build (host + webview)
bun run watch      # rebuild on change
```

There's no separate build step for this directory alone, and no dedicated test suite here; backend logic that the webview depends on (like `messaging.ts`) is tested from `../extension-backend`'s side in `test/unit/`.
