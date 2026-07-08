# Commands

All commands are available from the Command Palette (`Ctrl+Shift+P` or
`Cmd+Shift+P`). Type "Mallard" to filter.

## Mallard: Open Dashboard

ID `mallard.openDashboard`. Opens or focuses the dashboard in an editor tab.
The activity-bar sidebar (opened via its pop-out button) shows a segmented
spend gauge and a ranked model list; the editor-tab dashboard shows the
detailed charts:

- KPI cards: today, month-to-date, projected month-end, top model
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

## Mallard: Rebuild Ingested Data (Re-ingest From Scratch)

ID `mallard.clearData`. Asks for confirmation, then wipes recorded usage
events and re-parses every connector log from scratch. Your budget/alert
settings, dashboard layout, and pricing cache are left untouched — only the
ingested data is rebuilt. Use this if the dashboard's numbers look wrong and
you want a clean re-read of the underlying logs. Note that a rebuild is a
backfill: Copilot events are re-ingested as `unattributed` rather than being
guessed onto whatever repo is focused (Claude Code events keep their reliable
per-line attribution). To wipe everything
(including settings) before uninstalling, use **Mallard: Prepare for
Uninstall** instead.

## Mallard: Show Detected Log Path

ID `mallard.showLogPath`. Lists the log directories Mallard is watching (Copilot
and Claude Code) and how many files it found. Useful when the dashboard shows
the empty state. If Copilot's path is wrong, set `mallard.copilotLogPath`;
Claude Code's log directory is auto-detected and has no override setting.

## Mallard: Enable Copilot Usage Tracking

ID `mallard.enableCopilotTelemetry`. Points Copilot's OpenTelemetry file
exporter at a file Mallard reads, so local Copilot usage is tracked without
needing to sign in to GitHub. Prompts to reload the window afterward. Also
reachable from the empty-state CTA and, on first run with both Copilot and
Claude Code installed, from the onboarding flow.

## Mallard: Show Onboarding

ID `mallard.showOnboarding`. Re-runs the first-run setup flow: if both
Copilot and Claude Code are installed, asks which to track
(`mallard.enabledConnectors`); if Copilot is included and its OTel exporter
isn't enabled yet, offers to enable it (same as **Enable Copilot Usage
Tracking**). Runs automatically once on first activation; each step can be
dismissed (Escape) to stop the flow without changing anything further.

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
webhook exports and stores it in SecretStorage. Leave blank to clear.

## Mallard: Set Webhook Bearer Token

ID `mallard.setWebhookBearerToken`. Prompts for the token sent as
`Authorization: Bearer` on webhook exports and stores it in SecretStorage.
Leave blank to clear.

## Mallard: Set Webhook Signing Secret

ID `mallard.setWebhookSigningSecret`. Prompts for the HMAC signing secret and
stores it in SecretStorage. When set, every webhook POST carries an
`X-Mallard-Signature-256: sha256=<hex>` header — an HMAC-SHA256 of the exact
request body — which the server verifies when its `WEBHOOK_HMAC_SECRETS` is
configured. Optional defense-in-depth on top of the API key/bearer/mTLS auth;
see the Authentication reference. Leave blank to clear.

## Mallard: Set GitHub Personal Access Token

ID `mallard.setGitHubPat`. Prompts for a GitHub PAT (scopes: `read:user` for
user billing, `read:org` for org billing) and stores it in SecretStorage. Used
for GitHub billing when you don't want to use VS Code's built-in GitHub
sign-in — set `githubBilling.mode` to `"pat"` in `config.json` to skip the
OAuth prompt entirely. Leave blank to clear.

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
