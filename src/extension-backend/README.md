# Mallard Extension Host (extension-backend)

The VS Code extension host: activation, log ingestion, storage, pricing, billing, alerting, and the bridge to the webview UI in `../extension-frontend`. Compiled into `dist/extension.js` by the same esbuild run that produces the webview bundle; there's no separate build for this directory.

## Entry point

`extension.ts` exports `activate()`, which:

1. Builds the dependency-injection container (`container.ts`, `buildContainer()`), wrapped in a try/catch so a startup failure shows a clear error instead of a silent "command not found".
2. Registers all `mallard.*` commands (dashboard, refresh, export, GitHub sign-in, restriction simulation, etc).
3. Sets up the status bar item, showing today's credits, budget severity colour, and restriction state.
4. Starts `UsageService`, which drives ingestion and keeps the dashboard, sidebar, and status bar in sync.

## Structure

```
extension-backend/
├── extension.ts    activate() entry point
├── config.ts       reads and validates mallard.* VS Code settings
├── container.ts    dependency-injection wiring for all services below
├── app/            orchestration: UsageService, config/layout stores, restriction engine, report generation
├── ingest/         log discovery, file watching, OTel parsing
├── store/          DuckDB-backed event storage
├── pricing/        pricing manifest and currency conversion
├── billing/        GitHub billing reconciliation
├── domain/         pure types, rule evaluation, restriction engine, forecasters
├── export/         metric export over MQTT/webhook
├── ui/             webview panel management and host <-> webview messaging
└── util/           logging, time/DST helpers, git detection, misc
```

## app/

`UsageService` (`app/UsageService.ts`) is the central orchestrator: it reads events via `EventReader`, prices them with `PricingService`, applies the active filter, computes budget and forecast, evaluates alert rules, and emits a host-side `SnapshotData` (core + dims + billing facets, see `domain/types.ts`). The render-ready `chartData` is composed lazily in the `current` getter at the UI boundary, and GitHub billing rides its own `onDidChangeBilling` stream — a billing refresh never triggers a store re-read or a metric export. `UserConfigStore` persists rules/budgets/currency/layout to `config.json` (the single user-config store; `LayoutStore` is a thin facade over its `dashboard.panels` block); `RestrictionEngine` owns the restriction popup state; `EphemeralFlags` names the few machine-local globalState dismissal flags; `ReportGenerator` builds the standalone HTML export.

## ingest/

`IngestService` aggregates one `LogConnector` per data source: `CopilotConnector` for GitHub Copilot's OpenTelemetry export (a JSONL file or SQLite span DB, resolved from settings by `config.readCopilotOtel`) and `ClaudeCodeConnector` for Claude Code's JSONL session files. Both extend `BaseFileConnector`, whose `discover()` returns a discriminated ingest target (`ndjson` globs or a `sqlite` DB) that the base dispatches to `DuckDBFileReader.ingestGlob`/`ingestSqlite`. Copilot writes no usage by default; `ConnectorSetupGate` drives a generic detect → notify → enable flow over each connector's declared `SetupRequirement`s (e.g. `CopilotOtelRequirement`) to turn the exporter on. `locate.ts` handles platform-specific log directory discovery (including Snap and Flatpak paths).

## store/

DuckDB-backed event storage via `@duckdb/node-api`. Schema lives in `schema/ddl.ts`: an `events` table for raw per-request data, a `meta` table for ingest bookkeeping, and views that normalise cost-by-category and roll events up to daily totals. `EventWriter` handles retention (raw events for `mallard.dataRetentionDays`, older data rolled up to daily rows) and compaction. `MetaStore` tracks per-connector parse offsets so ingestion is idempotent across restarts; the database persists across VS Code sessions (only "Prepare for Uninstall" deletes it). Events carry an `attribution` column ('authoritative' | 'heuristic' | NULL): connectors apply the active-editor repo/branch heuristic only to live rows (watermark exists and ts within `LIVE_WINDOW_MS`), never to backfill.

## pricing/

`PricingService` resolves the credit-multiplier manifest in priority order: a cache younger than 24 hours, then a remote fetch, then the bundled fallback copy, validating shape before use either way. `CurrencyService` fetches daily FX rates from Frankfurter for display currency conversion; metric exports always use USD regardless.

## billing/

`GitHubSession` obtains an auth token via VS Code's built-in session API (falling back to a user-supplied PAT). `GitHubUsageService` calls GitHub's Copilot quota and billing endpoints, returns results as a `neverthrow` `Result` (no throws), and caches per scope for 5 minutes with retry/backoff via `p-retry`.

## domain/

Framework-free core logic:

- `types.ts`: the shared data model (`UsageEvent`, `UsageSnapshot`, `AlertRule`, etc).
- `expr/`: a minimal JSONLogic-style condition evaluator used by both alert rules and restrictions.
- `restriction/`: the pure restriction evaluator (the stateful engine lives in `app/RestrictionEngine.ts`, since it needs vscode + file I/O — domain/ stays framework-free, now enforced by ESLint import boundaries).
- `forecasters/`: pluggable month-end forecasters (linear regression, Holt-Winters seasonal).
- `aggregate.ts`, `budget.ts`, `alerts.ts`, `chartData.ts`, `format.ts`: snapshot aggregation, budget/pace calculation, alert firing, and chart-ready data shaping.

## export/

Pluggable metric export to a self-hosted Mallard server. `ExporterFactory` wires the configured transport (MQTT or webhook) and auth method into a `MetricExporter`; `AuthProvider` resolves credentials (API key, bearer token, or mTLS client cert) from settings and `SecretStorage`. `NullMetricExporter` is used when export is disabled, so callers never need to null-check.

## ui/

`DashboardPanel` hosts the pop-out editor-tab dashboard; `SidebarView` hosts the activity-bar panel. On the webview side, every chart (stock and extra) is declared once in `../extension-frontend/charts/registry.ts` — panel chrome, mount factory, dirty comparator, and layout defaults — and `main.ts` iterates the registry. Both render the same webview HTML (`webviewHtml.ts`) and talk to it through `dashboardBridge.ts`, which pushes `UsageSnapshot`/config/layout/restriction updates and relays filter and config changes back. Message shapes are defined once in `messaging.ts` and shared with `../extension-frontend` so both sides stay in sync.

## util/

Shared helpers with no domain logic of their own: `logger.ts` (tagged console logging), `time.ts` (DST-correct day bucketing via `Intl`), `repo.ts` (active git branch/repo detection), `nonce.ts` (webview CSP nonces), `vscodeHost.ts` (thin VS Code API wrappers), and `extensionDetector.ts` (remote-SSH Copilot-extension detection).

## Tests

Unit tests live in `../../test/unit/`, mirroring this structure: `connectors/` for `ingest/`, `forecasters/` for `domain/forecasters/`, `store/` for `store/`, plus top-level files like `restriction.test.ts`, `pricing.test.ts`, `metricExporter.test.ts`, and `usageService.test.ts`. Integration tests that exercise a real VS Code host live in `../../test/integration/`.

```bash
bun run check-types   # type-check both host and webview tsconfigs
bun run test:unit     # pure logic tests (mocha)
bun run test          # integration tests in a real VS Code host
```
