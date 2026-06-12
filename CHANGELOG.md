# Changelog

All notable changes to the Weevil extension are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Status bar spend indicator** — circular, budget-tinted chip showing
  cost/credits/tokens for the configured scope, with a click-through breakdown.
- **Dashboard webview** — usage-over-time chart with hour→year granularity tabs,
  spend-by-model donut, spend-by-repository bar chart, KPI cards (scope, MTD,
  projected month-end with confidence band, budget pace, top model, top repo),
  metric toggle, and per-repo filter. Built with ECharts under a strict CSP.
- **Compact sidebar** — activity-bar view with a quick usage summary and a
  shortcut to the full dashboard.
- **`@weevil` chat participant** — `today`, `forecast`, `models`, `repos`, and
  `tips` commands plus natural-language intent parsing; records its own turns
  with exact token counts.
- **Event store** — JSONL-backed, append-friendly, per-user storage with dedup,
  filtered queries, and automatic rollup/compaction of events past a 90-day raw
  window.
- **Capture pipeline** — accurate `@weevil` capture, best-effort local Copilot
  OTel log parsing, deterministic sample-data fallback, and a stubbed GitHub
  billing provider wired for future calibration.
- **Notifications** — extensible threshold and velocity rules with filter
  targeting and per-rule debounce.
- **Multi-repo attribution** — every event is tagged with its repository (via
  the built-in Git extension) and workspace folder, so totals aggregate across a
  `.code-workspace` and can be filtered per repo.
- **Forecasting** — linear month-end projection with a confidence band and an
  `insufficient-data` state for early in the month.
- **Budget & pace** — month-to-date usage, percent of budget/included credits,
  projected overage, and a pace status that drives status-bar tinting.
- **GitHub auth** — optional, consent-gated sign-in storing tokens only in
  `SecretStorage`.
- **Cost-saving tips** — curated, partly contextual catalog.
- **Accessibility** — ARIA tablist with keyboard navigation, chart labels,
  reduced-motion support, and no color-only meaning.

[Unreleased]: https://github.com/RedPandaMC/Weevil/commits/main
