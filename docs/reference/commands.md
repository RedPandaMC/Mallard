# Commands

All commands are available via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`). Type "Weevil" to filter.

## `Weevil: Open Dashboard`

**ID:** `weevil.openDashboard`

Opens (or focuses) the full Weevil dashboard panel. This is the same action triggered by clicking the status bar chip.

The dashboard shows:
- KPI cards — today, month-to-date, projected month-end, top model
- Spend gauge — credits used vs. your included allowance
- 30-day bar chart with a projected-pace line
- Model breakdown (horizontal bars, top 8 by credits)
- Sankey chart — model → surface flow (shown when ≥2 models and ≥2 surfaces are present)

## `Weevil: Refresh Now`

**ID:** `weevil.refresh`

Re-scans all discovered log files and recomputes the dashboard. Use this after switching machines or if the dashboard seems stale.

Under normal conditions this is not needed — Weevil watches log files in real time using `fs.watch` and updates automatically within a second or two of new log entries being written.

## `Weevil: Clear All Data`

**ID:** `weevil.clearData`

Shows a confirmation modal, then wipes all stored events from the local event store. The store lives in VS Code's global storage directory and persists across restarts; this command resets it to zero.

Use this to start fresh (e.g. after changing Copilot plans) or to free up disk space. Data cannot be recovered after clearing.

## `Weevil: Show Detected Log Path`

**ID:** `weevil.showLogPath`

Shows an information notification listing the log directory paths Weevil is currently watching, plus how many log files it found there. Useful for diagnosing the "nothing tracked yet" empty state.

If the path is wrong, set `weevil.copilotLogPath` to override it.

## `Weevil: Export Monthly Report`

**ID:** `weevil.exportReport`

Generates a standalone HTML file summarising your current usage snapshot, then prompts you to choose where to save it (defaults to `~/Downloads/weevil-report-YYYY-MM.html`). After saving, you can open it directly in your browser and print to PDF.

The report includes:
- Summary KPI cards — today, MTD, projected, budget status
- Daily usage table — 30 days of credits and cost
- Model breakdown table with percentage share
- GitHub billing detail (if signed in)
- Model-switching suggestions (if applicable)

## `Weevil: Sign In to GitHub`

**ID:** `weevil.signIn`

Initiates a GitHub authentication session so Weevil can fetch authoritative billing data from the GitHub API. If you are already signed into GitHub in VS Code, this may succeed silently.

Once signed in, the dashboard shows a "Verified by GitHub" badge alongside the actual charges reported by the API. If the local estimate and the API total differ by more than 10%, a divergence warning appears — this usually means usage from other devices or VS Code instances is included in the API total.
