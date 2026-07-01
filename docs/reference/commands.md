# Commands

All commands are available from the Command Palette (`Ctrl+Shift+P` or
`Cmd+Shift+P`). Type "Mallard" to filter.

## Mallard: Open Dashboard

ID `mallard.openDashboard`. Opens or focuses the dashboard in an editor tab, the
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

ID `mallard.refresh`. Re-scans discovered log files and recomputes the dashboard.
You rarely need this: Mallard watches the log files and updates within a second or
two of new entries. Use it after switching machines or if a view looks stale.

## Mallard: Clear All Data

ID `mallard.clearData`. Asks for confirmation, then wipes everything Mallard
stores: recorded usage events, your budget and alert settings, the saved
dashboard layout, and the cached pricing manifest. Run it to start fresh or
before uninstalling, since VS Code keeps an extension's storage after removal.
Cleared data cannot be recovered.

## Mallard: Show Detected Log Path

ID `mallard.showLogPath`. Lists the log directories Mallard is watching and how
many files it found. Useful when the dashboard shows the empty state. If the path
is wrong, set `mallard.copilotLogPath`.

## Mallard: Export Monthly Report

ID `mallard.exportReport`. Generates a standalone HTML file from your current
snapshot and asks where to save it (the default is
`~/Downloads/mallard-report-YYYY-MM.html`). Open it in any browser and print to
PDF. The report includes the summary KPIs, a 30-day daily table, a model
breakdown with percentage share, and GitHub billing detail when signed in. It
contains no external requests.

## Mallard: Sign In to GitHub

ID `mallard.signIn`. Starts a GitHub session so Mallard can fetch authoritative
billing data. If you are already signed in to GitHub in VS Code this usually
succeeds without a prompt. Once connected, the dashboard shows a connected status
with the actual charge reported by GitHub, which aggregates usage across every
machine you use.

## Mallard: Export Usage Data

ID `mallard.exportData`. Exports the raw event log to a file. A save dialog lets
you choose CSV or JSON format: the format is inferred from the file extension
you type (`.csv` or `.json`). The output contains one row per event with all
stored fields (timestamp, model, surface, source, credits, cost, tokens, repo,
branch).

## Mallard: Set MQTT Export Password

ID `mallard.setMqttPassword`. Prompts for the MQTT broker password and stores it
in VS Code's SecretStorage. Secrets are never written to settings files and are
not synced across machines by Settings Sync. Leave the input blank to clear a
previously saved password.

## Mallard: Simulate Restriction State

ID `mallard.simulateRestriction`. Evaluates all restriction rules against the current snapshot and writes the result (which rule, if any, would be active, its scope, and grace period) as JSON to the "Mallard Restriction" output channel. Nothing is disabled and no notification fires. Useful for checking a new `restrict` rule before it can actually disable Copilot.

## Mallard: Prepare for Uninstall

ID `mallard.prepareUninstall`. Clears all Mallard data before you uninstall the
extension. VS Code does not delete extension storage on uninstall, so running
this command first ensures nothing is left behind. After confirmation it:

1. Wipes the DuckDB event store.
2. Resets budget and alert settings.
3. Clears the saved layout and pricing cache.
4. Deletes all `globalState` keys and secrets.

Once the command completes, uninstall from the Extensions view as usual.
