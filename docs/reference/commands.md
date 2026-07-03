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

ID `mallard.showLogPath`. Lists the log directories Mallard is watching (Copilot
and Claude Code) and how many files it found. Useful when the dashboard shows
the empty state. If Copilot's path is wrong, set `mallard.copilotLogPath`;
Claude Code's log directory is auto-detected and has no override setting.

## Mallard: Export Monthly Report

ID `mallard.exportReport`. Generates a standalone HTML file from your current
snapshot and asks where to save it (the default is
`~/Downloads/mallard-report-YYYY-MM.html`). Open it in any browser and print to
PDF. The report includes the summary KPIs, a 30-day daily table, a model
breakdown with percentage share, and GitHub billing detail when signed in. It
contains no external requests.

## Mallard: Sign In to GitHub

ID `mallard.signIn`. Starts a GitHub session so Mallard can fetch authoritative
Copilot billing data. If you are already signed in to GitHub in VS Code this
usually succeeds without a prompt. Once connected, the dashboard shows a
connected status with the actual Copilot charge reported by GitHub, which
aggregates usage across every machine you use. This is Copilot-specific:
GitHub exposes a user-scoped billing API that Anthropic doesn't, so there's no
equivalent sign-in for an authoritative Claude Code charge; its usage stays
log-based (estimated).

## Mallard: Export Usage Data

ID `mallard.exportData`. Exports the raw event log to a file. A save dialog lets
you choose CSV or JSON format: the format is inferred from the file extension
you type (`.csv` or `.json`). The output contains one row per event with all
stored fields (timestamp, model, surface, source, credits, cost, tokens, repo,
branch).

## Mallard: Manage Credentials

ID `mallard.manageCredentials`. One place for every secret Mallard stores: a
picker lists each credential slot (webhook API key, webhook bearer token,
webhook signing secret, MQTT password, GitHub personal access token) with its
configured/not-configured status — values are never shown — and offers
Set/Update or Clear per slot. All credentials live in VS Code's SecretStorage
(your OS keychain); they are never written to settings files and are not synced
across machines by Settings Sync.

## Mallard: Set MQTT Export Password

ID `mallard.setMqttPassword`. Prompts for the MQTT broker password and stores it
in VS Code's SecretStorage. Secrets are never written to settings files and are
not synced across machines by Settings Sync. Leave the input blank to clear a
previously saved password.

## Mallard: Set Webhook API Key

ID `mallard.setWebhookApiKey`. Prompts for the API key sent as `X-API-Key` on
webhook exports and stores it in SecretStorage. Replaces the deprecated
plaintext `mallard.webhook.apiKey` setting — an existing setting value is
migrated automatically on startup. Leave blank to clear.

## Mallard: Set Webhook Bearer Token

ID `mallard.setWebhookBearerToken`. Prompts for the token sent as
`Authorization: Bearer` on webhook exports and stores it in SecretStorage.
Replaces the deprecated plaintext `mallard.webhook.bearerToken` setting — an
existing setting value is migrated automatically on startup. Leave blank to
clear.

## Mallard: Set GitHub Personal Access Token

ID `mallard.setGitHubPat`. Prompts for a GitHub PAT (scopes: `read:user` for
user billing, `read:org` for org billing) and stores it in SecretStorage. Used
for GitHub billing when you don't want to use VS Code's built-in GitHub
sign-in — set `githubBilling.mode` to `"pat"` in `config.json` to skip the
OAuth prompt entirely. A PAT found in `config.json`'s deprecated `pat` field is
copied into SecretStorage on first use. Leave blank to clear.

## Mallard: Simulate Restriction State

ID `mallard.simulateRestriction`. Evaluates all restriction rules against the current snapshot and writes the result (which rule, if any, would be active) as JSON to the "Mallard Restriction" output channel. No popup shows and nothing is disabled. Useful for checking a new `restrict` rule before enabling it.

## Mallard: Disable This Extension

ID `mallard.disableExtension`. Opens the Extensions view filtered to Mallard so you can disable it yourself in one click. Also reachable from the **Disable Mallard...** button on a restriction popup. This is a manual step, not an automatic disable; local data is kept so re-enabling picks up where you left off.

## Mallard: Prepare for Uninstall

ID `mallard.prepareUninstall`. Clears all Mallard data before you uninstall the
extension. VS Code does not delete extension storage on uninstall, so running
this command first ensures nothing is left behind. After confirmation it:

1. Wipes the DuckDB event store.
2. Resets budget and alert settings.
3. Clears the saved layout and pricing cache.
4. Deletes all `globalState` keys and secrets.

Once the command completes, uninstall from the Extensions view as usual.
