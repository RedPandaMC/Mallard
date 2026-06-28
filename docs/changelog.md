# Changelog

## 0.2.0 — 2026-06-25

### Added

- **Activity-bar sidebar panel** — replaces the placeholder tree view with a live
  WebviewView. Shows the month-to-date spend gauge (with severity colouring at 80 %
  and 100 % of budget) and a ranked model breakdown with duotone bars. Clicking the
  activity-bar icon opens the full dashboard; clicking "↗" in the panel header does
  the same.
- **Background log ingest** — the extension activates instantly, fires an initial
  snapshot with a `loading` status, then parses log files in the background. The
  status banner reads "Reading log files…" during the brief load and transitions to
  real data as soon as ingest finishes. Startup no longer blocks on log parsing.
- **`loading` status kind** — propagated from `ConnectorStatus` through
  `IngestService.getStatus()` to `ProviderStatusKind` and the dashboard status
  banner, so every surface shows the same loading state consistently.
- **CI/CD: `.vsix` artifact** — every push to `main` triggers a `package` job that
  runs `vsce package` (which auto-runs the production esbuild) and uploads
  `mallard-*.vsix` as a downloadable Actions artifact (90-day retention).

### Fixed

- **Dashboard command error** — a dead reference to a `monaco.workers.js` file that
  was never built prevented `mallard.openDashboard` from loading the webview. The
  reference and the matching `worker-src` CSP directive have been removed.
- **Extension activation crash** — `buildContainer` is now wrapped in a try/catch
  that surfaces a clear VS Code error message and stops command registration if
  startup fails, preventing silent "command not found" errors.
- **Dashboard layout** — restructured to match the design handoff: KPI cards → spend
  gauge beside the restriction banner (two-column `wv-gauge-row` grid) → filter bar
  → analysis controls → charts grid with a section label. Standalone model-list
  section removed (data is in the models chart panel).

### Changed

- Docs site no longer shows a redundant header navbar; the sidebar covers all
  navigation. Prev / Next page buttons appear at the bottom of every doc page.

---

## 0.1.4 — 2026-06-25

### Added

- **Remote session warning** — when Mallard detects it is running over Remote SSH
  or GitHub Codespaces and finds no Copilot log files, it shows a one-time warning
  explaining that Copilot logs live on the local machine and cannot be read from a
  remote container. A "Don't show again" option suppresses future warnings.
- **Multi-currency display** — costs are now formatted in the user's system locale
  currency rather than hard-coded USD.
- **HTML placeholders in alert messages** — the `message` field in restriction rules
  now accepts inline HTML for richer formatted notifications.
- Troubleshooting docs entry for the remote-SSH log-access limitation.

### Fixed

- **Reingest bug** — the file watcher was re-processing already-ingested lines after
  a log rotation event, causing duplicate events in the store.
- **CI test timeout** — the integration test suite was timing out on slow CI
  runners; the runner timeout has been raised and a flaky await removed.
- SVG asset duplication removed; unused generated files cleaned up.

---

## 0.1.3 — 2026-06-23–24

### Performance

- **DuckDB-centric rewrite** (PR #16) — the Kysely query-builder layer was replaced
  with direct DuckDB SQL. Measured improvement: **160× faster** event insert,
  **18× faster** snapshot aggregation. Kysely removed from dependencies.
- **Single-CTE filtered snapshot** (PR #18/#19) — `readFilteredSnapshot` previously
  fired 13 concurrent queries via `Promise.all`. Replaced with a single parameterised
  SQL CTE; the query planner handles all filtering in one pass.
- Star-schema dimensions (`dim_model`, `dim_workspace`, `dim_repo`) and a
  materialised `fact_daily_usage` table replace the raw-event-only schema, enabling
  the composable view hierarchy for daily rollup and cost-type breakdown.

### Changed

- **SOLID/DRY/SoC refactor** (PR #17) — `EventStore`, `IngestService`, and
  `UsageService` restructured to single-responsibility classes with explicit
  interfaces. Dependency injection throughout; no static state.
- 100 % branch coverage restored and enforced in CI after the rewrite.

---

## 0.1.2 — 2026-06-22

### Added

- **Claude Code connector improvements** (PR #14) — closed capability gaps relative
  to the Copilot connector: model-key normalisation, thinking-token accounting,
  conversation-vs-tool split.
- Dark/light logo variants in the README, switching automatically via the GitHub
  markdown `#gh-dark-mode-only` / `#gh-light-mode-only` mechanism.

### Fixed

- **MQTT multi-instance topic collision** — two VS Code windows publishing to the
  same broker would overwrite each other's retained messages. A stable anonymous
  instance hash is now appended to the topic automatically.
- MQTT payload made schema-evolution-safe: unknown fields are preserved rather than
  stripped, allowing a broker to receive payloads from mixed extension versions.
- Duplicate `gen_ai.request.model` OTel attribute key removed (caused TS2783 error
  at compile time).

### Changed

- 100 % test coverage (statements / branches / functions / lines) achieved and
  enforced in CI across all source files.

---

## 0.1.1 — 2026-06-21

### Added

- **HTTP webhook transport** — set `mallard.metricExport.webhook.url` (HTTPS only)
  to POST metric payloads to any receiver. Each request includes an
  `X-Mallard-Signature-256` HMAC header for verification. Configurable retries with
  exponential backoff, extra headers, and an optional signing secret.
- **MQTT vector export** — set `mallard.metricExport.brokerUrl` to publish
  structured usage feature-vectors to a TLS MQTT broker (`mqtts://` or `wss://`).
  Supports username/password and mTLS client certificates.
- **Expanded alerting** — threshold escalation levels, snooze duration, and
  structured `conditions` shorthand (no DSL required). Alert rules support
  named `vars`, `groups`, and a `restrict` action that blocks Copilot inline
  completions.
- **Holt-Winters seasonal forecaster** — pluggable `Forecaster` seam; the
  triple-exponential method is selected automatically when enough history is present,
  falling back to linear regression.
- **Hourly timeline chart** — per-hour bar chart for the selected day range.
- **Model comparison ghost bar** — overlays the previous period's model spend
  against the current bar for instant visual comparison.
- **Branch-level budget** — budget ceiling configurable per Git branch pattern.
- **Multi-workspace support** — tracks usage per VS Code workspace; per-repo filter
  in the dashboard.
- **GitHub billing BYOK** — bring-your-own token option for GitHub billing
  reconciliation without the VS Code session flow.
- **Dashboard CSS-grid layout** — user can drag panels into a persistent grid
  arrangement. Layout resets via `Mallard: Clear All Data`.

### Changed

- Monaco DSL editor removed; alert rules are now plain JSON with a `conditions`
  shorthand validated against the config JSON Schema.
- MetricExporter extracted into its own injectable class (DI); no longer a
  static singleton.
- Flatpak and Snap VS Code log paths added to the Linux auto-discovery list.

---

## 0.1.0 — 2026-06-12–14

Initial public release.

### Features

- **Live dashboard** — opens as an activity-bar panel or a full editor-tab webview.
  KPI cards (total spend, requests, top model, daily average), a spend gauge, a
  30-day cost bar chart, a per-model breakdown, a model-to-surface Sankey flow
  chart, and a spend-by-cost-type doughnut. All aggregation runs in the extension
  host; charts below the fold initialise lazily.
- **Swiss duotone design** — Archivo display face, Hanken Grotesk body, IBM Plex
  Mono for labels and numbers. Cinnabar red (`#E5231B`) accent over a 6-stop
  greyscale ramp. Accessible contrast enforced; a `mallard.palette: "theme"`
  option derives the accent from the active VS Code colour theme.
- **Embedded DuckDB event store** — uses the N-API bindings, which are ABI-stable
  across Node and Electron so no native rebuild is needed. Persists to a single file
  with a raw-events window and daily rollup. Log-read offsets are stored so startup
  never re-scans files.
- **Budget and alerts** — monthly budget cap, included-credits offset, daily-credit
  alert, and spending-velocity alert, all configured in the dashboard.
  `mallard.config.json` in `.vscode/` provides workspace-level overrides validated
  against the bundled JSON Schema.
- **Restriction engine** — alert rules can trigger a `restrict` action that blocks
  GitHub Copilot inline completions until the condition clears or the user overrides
  for N minutes. Named scopes, a grace period, and a simulate command for testing
  rules before deploying them.
- **GitHub billing reconciliation** — optional sign-in via VS Code's session API
  surfaces your Copilot plan, included quota, and overage rate alongside the
  log-derived cost.
- **Exportable HTML report** — `Mallard: Export Monthly Report` generates a
  standalone, printable HTML file with the current snapshot.
- **Workspace-aware repo attribution** — each event is tagged with the active
  workspace and Git repo; the dashboard has a per-repo filter.
- **Pricing manifest** — bundled and refreshed daily from the canonical source;
  validated against a Zod schema before use.
- **Log auto-discovery** — searches standard VS Code, VS Code Insiders, VSCodium,
  VS Code Server, Flatpak, and Snap log locations on all platforms. Override via
  `mallard.copilotLogPath` or the folder-picker in `Mallard: Show Detected Log Path`.
- **CI/CD** — GitHub Actions workflow using Bun; type-check, lint, unit tests with
  c8 coverage, and integration tests on every pull request.
