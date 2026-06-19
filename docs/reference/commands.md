# Commands

All commands are available from the Command Palette (`Ctrl+Shift+P` or
`Cmd+Shift+P`). Type "Mallard" to filter.

## Mallard: Open Dashboard

ID `weevil.openDashboard`. Opens or focuses the dashboard in an editor tab, the
same view shown in the activity-bar sidebar (and reachable via its pop-out
button). The dashboard shows:

- KPI cards: today, month-to-date, projected month-end, top model
- A spend gauge: credits used against your included allowance
- A 30-day bar chart with a projected-pace line
- A model breakdown (top eight by credits)
- A flow chart of model to surface
- A spend-by-cost-type chart (input and output), shown when that detail is
  available
- A repo selector, shown when more than one repo is present, so you can attribute
  usage per workspace

## Mallard: Refresh Now

ID `weevil.refresh`. Re-scans discovered log files and recomputes the dashboard.
You rarely need this: Mallard watches the log files and updates within a second or
two of new entries. Use it after switching machines or if a view looks stale.

## Mallard: Clear All Data

ID `weevil.clearData`. Asks for confirmation, then wipes everything Mallard
stores: recorded usage events, your budget and alert settings, the saved
dashboard layout, and the cached pricing manifest. Run it to start fresh or
before uninstalling, since VS Code keeps an extension's storage after removal.
Cleared data cannot be recovered.

## Mallard: Show Detected Log Path

ID `weevil.showLogPath`. Lists the log directories Mallard is watching and how
many files it found. Useful when the dashboard shows the empty state. If the path
is wrong, set `weevil.copilotLogPath`.

## Mallard: Export Monthly Report

ID `weevil.exportReport`. Generates a standalone HTML file from your current
snapshot and asks where to save it (the default is
`~/Downloads/weevil-report-YYYY-MM.html`). Open it in any browser and print to
PDF. The report includes the summary KPIs, a 30-day daily table, a model
breakdown with percentage share, and GitHub billing detail when signed in. It
contains no external requests.

## Mallard: Sign In to GitHub

ID `weevil.signIn`. Starts a GitHub session so Mallard can fetch authoritative
billing data. If you are already signed in to GitHub in VS Code this usually
succeeds without a prompt. Once connected, the dashboard shows a connected status
with the actual charge reported by GitHub, which aggregates usage across every
machine you use.
