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
  aggregation runs in the extension host; charts below the fold initialise lazily.
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

### Changed

- Reorganised the source into concern-based modules (ingest, store, pricing,
  billing, domain, app, ui).
- Reduced VS Code settings to two (`copilotLogPath`, `pricingManifestUrl`);
  budget and alert config moved into the dashboard.
- Tightened the webview CSP to allow no inline styles and no external origins.

### Removed

- Model-switching suggestions.
- Sample and synthetic data; the dashboard now degrades to "not enough data".
- The `@mallard` chat participant and JSON notification rule schemas.

[Unreleased]: https://github.com/RedPandaMC/Mallard/commits/main
