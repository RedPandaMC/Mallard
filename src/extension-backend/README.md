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
├── app/            orchestration: UsageService, config/layout stores, report generation
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

`UsageService` (`app/UsageService.ts`) is the central orchestrator: it reads events via `EventReader`, prices them with `PricingService`, applies the active filter, computes budget and forecast, evaluates alert rules, and emits a `UsageSnapshot` that the dashboard, sidebar, and status bar all subscribe to. It also owns GitHub billing refresh and metric export triggering. `UserConfigStore` persists rules/budgets/variables to `config.json`; `LayoutStore` persists the dashboard panel arrangement; `ReportGenerator` builds the standalone HTML export.

## ingest/

`IngestService` aggregates one `LogConnector` per data source: `CopilotConnector` for GitHub Copilot's OTel logs and `ClaudeCodeConnector` for Claude Code's JSONL session files. `locate.ts` handles platform-specific log directory discovery (including Snap and Flatpak paths). `otelParse.ts` parses log lines incrementally, tracking file offsets so re-scans never reprocess already-ingested data.

## store/

DuckDB-backed event storage via `@duckdb/node-api`. Schema lives in `schema/ddl.ts`: an `events` table for raw per-request data, a `meta` table for ingest bookkeeping, and views that normalise cost-by-category and roll events up to daily totals. `EventWriter` handles retention (raw events for `mallard.dataRetentionDays`, older data rolled up to daily rows) and compaction. `MetaStore` tracks per-connector parse offsets so ingestion is idempotent across restarts.

## pricing/

`PricingService` resolves the credit-multiplier manifest in priority order: a cache younger than 24 hours, then a remote fetch, then the bundled fallback copy, validating shape before use either way. `CurrencyService` fetches daily FX rates from Frankfurter for display currency conversion; metric exports always use USD regardless.

## billing/

`GitHubSession` obtains an auth token via VS Code's built-in session API (falling back to a user-supplied PAT). `GitHubUsageService` calls GitHub's Copilot quota and billing endpoints, returns results as a `neverthrow` `Result` (no throws), and caches per scope for 5 minutes with retry/backoff via `p-retry`.

## domain/

Framework-free core logic:

- `types.ts`: the shared data model (`UsageEvent`, `UsageSnapshot`, `AlertRule`, etc).
- `expr/`: a minimal JSONLogic-style condition evaluator used by both alert rules and restrictions.
- `restriction/`: the Copilot-restriction engine, evaluating `restrict` blocks against the live snapshot and persisting state to `restriction.json`.
- `forecasters/`: pluggable month-end forecasters (linear regression, Holt-Winters seasonal).
- `aggregate.ts`, `budget.ts`, `alerts.ts`, `chartData.ts`, `format.ts`: snapshot aggregation, budget/pace calculation, alert firing, and chart-ready data shaping.

## export/

Pluggable metric export to a self-hosted Mallard server. `ExporterFactory` wires the configured transport (MQTT or webhook) and auth method into a `MetricExporter`; `AuthProvider` resolves credentials (API key, bearer token, or mTLS client cert) from settings and `SecretStorage`. `NullMetricExporter` is used when export is disabled, so callers never need to null-check.

## ui/

`DashboardPanel` hosts the pop-out editor-tab dashboard; `SidebarView` hosts the activity-bar panel. Both render the same webview HTML (`webviewHtml.ts`) and talk to it through `dashboardBridge.ts`, which pushes `UsageSnapshot`/config/layout/restriction updates and relays filter and config changes back. Message shapes are defined once in `messaging.ts` and shared with `../extension-frontend` so both sides stay in sync.

## util/

Shared helpers with no domain logic of their own: `logger.ts` (tagged console logging), `time.ts` (DST-correct day bucketing via `Intl`), `repo.ts` (active git branch/repo detection), `nonce.ts` (webview CSP nonces), `vscodeHost.ts` (thin VS Code API wrappers), and `extensionDetector.ts` (remote-SSH Copilot-extension detection).

## Tests

Unit tests live in `../../test/unit/`, mirroring this structure: `connectors/` for `ingest/`, `forecasters/` for `domain/forecasters/`, `store/` for `store/`, plus top-level files like `restriction.test.ts`, `pricing.test.ts`, `metricExporter.test.ts`, and `usageService.test.ts`. Integration tests that exercise a real VS Code host live in `../../test/integration/`.

```bash
bun run check-types   # type-check both host and webview tsconfigs
bun run test:unit     # pure logic tests (mocha)
bun test               # integration tests in a real VS Code host
```
