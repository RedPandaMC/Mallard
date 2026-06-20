# Changelog

All notable changes to the Mallard extension are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

This release refocuses Mallard on its core: parse Copilot's local OTel logs for
real-time per-model cost, with optional GitHub billing reconciliation.

### Added

- Dashboard in the activity-bar view (with a pop-out to an editor tab).
- Dashboard with KPI cards, a spend gauge, a 30-day bar chart, a model
  breakdown, a model-to-surface flow chart, and a spend-by-cost-type chart. All
  aggregation runs in the extension host; charts load on scroll.
- Budget, included credits, daily-credit alert, and spending-velocity alert,
  edited in the dashboard and stored per user.
- Cost-category breakdown: each request's cost is split into input and output by
  token ratio, stored on the event for future tool and thinking categories.
- Workspace-aware repo attribution and a per-repo filter.
- Linear month-end forecast behind a pluggable forecaster seam.
- Optional GitHub billing reconciliation through VS Code's session API.
- Exportable, standalone, printable HTML report.
- Embedded DuckDB event store (via the N-API bindings, which are ABI-stable
  across Node and Electron, so there is no native module to rebuild). Persists to
  a single file with a recent-raw window and daily rollup, and persists log read
  offsets so startup never re-scans logs.
- Pricing manifest bundled and refreshed daily, validated before use.
- Activity-bar launcher: Mallard icon opens the dashboard directly from the
  sidebar without needing the Command Palette.
- Restriction engine: any alert rule can carry a `restrict` block that
  soft-warns or hard-disables Copilot extensions when the condition fires, with a
  configurable grace period and `reEnableWhen` auto-lift condition.
- `RestrictionBanner` webview component shows the active restriction state and
  remaining grace time inside the dashboard.
- Accessible palette setting (`mallard.palette`): `swiss` uses a fixed duotone
  palette; `theme` derives chart colours from the active VS Code theme.
- Cumulative-area chart: shows spend accumulating through the month alongside
  the daily bar chart.
- Weekday-radial chart: visualises average spend by day of the week.
- Hourly timeline chart: shows per-hour credit usage for the current day with a
  peak-hour callout.
- Model comparison ghost bar: each model row in the breakdown shows the cost of
  the cheapest equivalent model as a ghost bar, making relative cost visible.
- Branch-level budget tracking: tag usage to the current git branch and set
  per-branch credit caps in `config.json`. Mallard warns when a branch crosses
  its threshold.
- Streamed / diff-based incremental chart rendering: chart panels re-render only
  when their underlying data changes, reducing CPU usage on idle snapshots.
- MQTT metric streaming (`mallard/v2/metrics`): after each snapshot, Mallard
  pushes an expanded metric payload to any `mqtts://` or `wss://` broker. The
  payload covers model distribution, surface distribution, spend velocity, MTD
  budget fraction, hourly peak, forecast bounds, and more — all GDPR-safe
  (counts and fractions only, no repo names, branch names, or user identifiers).
- JSON conditions system: alert rules can now use a structured `conditions`
  array (`{ field, op, value }`) alongside the existing JSONLogic `when` syntax.
  The `jsonCondition.ts` evaluator handles `>`, `<`, `>=`, `<=`, `==`, `!=`,
  `in`, and `matches` operators.
- 100% unit test coverage across the domain layer.
- Property-based security tests (fast-check): fuzz the path-traversal guard,
  `evalCondition`, and all formatters with arbitrarily-generated inputs.
- Generic `EventRepository` interface over `EventStore`: standardised method
  names (`insert`, `find`, `aggregate`, `bucket`, `pivot`, `rank`, `compact`,
  `dump`) make the data layer testable without a DuckDB process.

### Changed

- Reorganised the source into concern-based modules (ingest, store, pricing,
  billing, domain, app, ui).
- Reduced VS Code settings to two (`copilotLogPath`, `pricingManifestUrl`);
  budget and alert config moved into the dashboard.
- Tightened the webview CSP to allow no inline styles and no external origins.
- MQTT topic updated from `mallard/metrics` to `mallard/v2/metrics` to
  distinguish the expanded payload format from earlier snapshots.
- Metric serializer renamed from `VectorSerializer` to `MetricPayloadSerializer`;
  the payload module is now `src/export/payload.ts`.
- `MetricExporter` refactored into a DI orchestrator: `MetricProtocol` and
  `MetricSerializer` are injected, making each independently testable.

### Removed

- Model-switching suggestions.
- Sample and synthetic data; the dashboard now degrades to "not enough data".
- The `@mallard` chat participant and JSON notification rule schemas.
- Monaco-based alert config editor (replaced by the `config.json` + JSON Schema
  approach with VS Code's built-in editor).

[Unreleased]: https://github.com/RedPandaMC/Mallard/commits/main
