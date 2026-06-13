# Weevil — Project Goals

## One-sentence pitch

Give VS Code users real-time visibility into exactly what GitHub Copilot is costing them, using only local data and optional GitHub API reconciliation — no manual setup, no telemetry, no surprises.

---

## Core promise

Parse Copilot's local OpenTelemetry logs for real-time per-model detail, and optionally reconcile with GitHub's billing API for authoritative totals — so you always know both what is happening right now and what GitHub is actually charging you.

---

## What Weevil tracks

Copilot writes OTel JSON-lines logs to VS Code's log directory. These contain: model name, input tokens, output tokens, timestamp, and surface (chat / inline / agent / edit). Weevil reads these files continuously and turns them into a live usage snapshot. This is the only data source — no network calls required for the core experience.

---

## Goals by area

### 1. Real-time cost visibility

- Show today's spend, month-to-date spend, and projected month-end cost in a status bar chip and a sidebar gauge.
- Colour-code by budget health: green (< 70% of included credits), amber (70–100%), red (over).
- Update within seconds of new log entries being written — no manual refresh needed.

### 2. Accurate pricing without manual maintenance

- Bundle a `pricing-manifest.json` with current Copilot credit multipliers by model.
- Refresh the manifest once per day from a known URL; fall back to the bundled copy when offline.
- When GitHub changes pricing, a one-line JSON update to the repo propagates automatically — no user action required.

### 3. Authoritative GitHub billing reconciliation (opt-in)

- Optionally connect to GitHub's billing API (`/users/{username}/settings/billing/ai_credit/usage`) with a silent, non-intrusive sign-in.
- Show a "Verified by GitHub" badge with the actual charge alongside the local estimate.
- Warn when local and API totals diverge by more than 10% (e.g. usage from other devices).
- Never show a sign-in modal at startup; auth is entirely opt-in.

### 4. Smart model-switching suggestions

- After 14+ days of data, analyse which premium models are used heavily for low-value surfaces (inline completions).
- Suggest cheaper alternatives and show the estimated monthly saving.
- Pure local analysis — no external AI call.

### 5. Forecasting

- Linear regression over recent daily aggregates projects the month-end cost.
- Shown prominently in KPI cards, the spend gauge subtext, and the daily bar chart.
- Gracefully degrades to "not enough data" for new users (< 3 active days).

### 6. Alerting (two simple settings, no rule schemas)

- `weevil.monthlyBudget`: fire a toast at 80% and 100% of the USD budget threshold.
- `weevil.alert.dailyCredits`: fire a toast when daily credit usage exceeds the threshold.
- Cooldown prevents repeated notifications; no complex notification rule JSON.

### 7. Exportable reports

- Generate a standalone, printable HTML report (saveable as PDF from any browser).
- Sections: summary KPIs, 30-day daily usage table, model breakdown, GitHub billing detail, suggestions.
- Saved anywhere the user chooses via a standard save dialog.

### 8. Performance — compute on the host, paint on the webview

- All aggregation, colour assignment, and label formatting happens in the extension host (Node.js).
- The webview receives pre-computed, render-ready structs (`DailyBarsData`, `ModelBreakdownData`, `HeatmapData`) — it only paints.
- ECharts uses incremental (`notMerge: false`) updates to avoid full reflows.
- Charts below the fold initialise lazily via `IntersectionObserver`.
- Target: snapshot update → visible DOM change < 16ms (one frame at 60fps).

### 9. Security

- Strict CSP on all webview panels: no `unsafe-inline`, no external origins.
- Pricing manifest is fetched with a 5-second timeout, validated with Zod before caching, never executed.
- Log path validated against known safe roots; paths with `..` are rejected.
- No credentials stored; GitHub auth uses VS Code's built-in session API.

### 10. Zero required configuration

- Auto-detects log path via `vscode.env.logUri`.
- Bundles default pricing; refreshes automatically.
- Works the moment Copilot is installed and used — no API keys, no settings changes.

---

## What Weevil deliberately does not do

| Removed / excluded | Reason |
|--------------------|--------|
| `@weevil` chat participant | Low value, high VS Code API surface |
| Sample / fake data mode | Actively misleads users |
| Notification rule schemas (JSON) | Replaced by 2 simple number settings |
| Granularity tabs beyond day/week/month | Clutter |
| Repo breakdown chart | Requires git attribution; noisy without reliable data |
| `weevil.dataSource` setting | Only one source: local logs |
| Mascot / pet | Noise |
| Telemetry | Not without VS Code's global opt-in |

---

## Settings (5 total)

| Key | Default | Purpose |
|-----|---------|---------|
| `weevil.copilotLogPath` | `""` | Override log directory (blank = auto) |
| `weevil.includedCredits` | `300` | Monthly included premium requests |
| `weevil.monthlyBudget` | `0` | USD monthly alert threshold (0 = off) |
| `weevil.alert.dailyCredits` | `0` | Daily credit alert threshold (0 = off) |
| `weevil.pricingManifestUrl` | `""` | Override pricing manifest URL (blank = default) |

## Commands (6 total)

| Command | Purpose |
|---------|---------|
| `weevil.openDashboard` | Open full dashboard panel |
| `weevil.refresh` | Re-scan logs and recompute |
| `weevil.clearData` | Wipe all stored events |
| `weevil.showLogPath` | Show detected log file paths |
| `weevil.signIn` | Sign in to GitHub for billing verification |
| `weevil.exportReport` | Save a printable HTML usage report |
