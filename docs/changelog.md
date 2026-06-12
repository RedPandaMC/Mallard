# Changelog

## 0.2.0 — 2025-06-12

### What changed

This release is a focused redesign. The core promise is unchanged — parse Copilot's local OTel logs and give you a clear picture of what you're spending — but everything that wasn't earning its place has been cut.

**Removed:**
- `@weevil` chat participant (low value, high VS Code API surface)
- Sample data provider (fake data actively misleads)
- GitHub Billing API stub (added zero value, created security surface)
- Complex JSON notification rules engine (replaced with two plain settings)
- Tips panel
- Hour / quarter / year granularity tabs (kept day / week / month)
- Repo breakdown chart (unreliable without solid git attribution)
- `weevil.setScope` command and status bar scope selector
- `weevil.showBreakdown` QuickPick

**Added:**
- Sankey chart — model → surface flow (visible when ≥2 models and ≥2 surfaces)
- Empty state with setup guide (instead of confusing silence)
- SpendGauge — horizontal CSS progress bar in sidebar and dashboard
- Automatic pricing discovery — bundled manifest refreshed daily, no settings change needed when GitHub updates prices
- `LogWatcher` — `fs.watch`-based incremental log parsing (replaces polling interval)
- Path-traversal guard on all log file reads
- 30-day bar chart with projected-pace line and optional budget line

**Changed:**
- Filter redesigned: date-range preset buttons + model multi-select + surface toggle chips
- Status bar click goes directly to dashboard (no QuickPick)
- KPI cards: today / MTD / projected / top model (4 cards, no clutter)
- All UI icons use `@vscode/codicons`; no bespoke SVGs except the Weevil logo
- Brand colour tokens replaced with VS Code theme tokens (`--vscode-button-background`)
- Alerting: two plain number settings (`weevil.monthlyBudget`, `weevil.alert.dailyCredits`)

**Commands (4):** openDashboard, refresh, clearData, showLogPath

**Settings (5):** copilotLogPath, includedCredits, monthlyBudget, alert.dailyCredits, pricingManifestUrl

---

## 0.1.x — earlier

Initial release. Included sample data, GitHub Billing stub, chat participant, complex notification rules, and many settings. Superseded by 0.2.0.
