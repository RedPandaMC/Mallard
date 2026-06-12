# Troubleshooting

This guide covers common issues and their solutions.

## Dashboard Shows "No Data Yet"

Weevil needs a moment to ingest available logs.

**Try these steps:**

1. Run `Weevil: Refresh` from the Command Palette
2. Wait 15 minutes for the next automatic refresh
3. Check `weevil.dataSource` is set to `auto` (default)

**If using `local` mode:**

- Verify Copilot OTel logs exist at the auto-detected path
- Set `weevil.copilotLogPath` explicitly if logs are in a custom location
- Run `Weevil: Refresh` after starting Copilot to capture new log entries

**If still showing no data:**

```json
"weevil.dataSource": "auto"
```

This enables the sample data fallback.

## Status Bar Shows "--"

This means Weevil hasn't recorded any usage events for the selected scope.

**Causes:**

1. No Copilot usage yet (normal for new installations)
2. Events exist but not for the selected scope (`session`, `today`, `workspace`, `repo`)
3. Log files haven't been refreshed yet

**Solutions:**

- Run `Weevil: Refresh` to trigger immediate log ingestion
- Check the status bar scope: run `Weevil: Set Status Bar Scope` and select `today`
- If using `local` mode, verify logs are being written

## Costs Seem Higher Than GitHub Billing

Weevil estimates costs from token counts and credit multipliers, which may differ
from GitHub's actual billing due to:

1. **Rounding differences** — GitHub rounds credits differently
2. **Missing log data** — Some OTel entries lack token counts (marked as `estimated`)
3. **Plan differences** — Included credits may not match your plan

**For accurate billing:** Check your GitHub invoice directly at
`github.com/settings/billing`.

**To improve accuracy:**

- Enable Copilot debug logging for more complete OTel traces
- Connect GitHub via `Weevil: Connect GitHub` for future calibration

## Chat Participant Not Responding

The `@weevil` chat participant requires VS Code's built-in GitHub authentication.

**Fix:**

1. Run `Weevil: Sign In` from the Command Palette
2. Complete the GitHub authentication flow in the browser
3. Restart the chat session

**Note:** The sidebar and dashboard work without GitHub sign-in. Only the
`@weevil` chat participant requires authentication.

## Notifications Not Firing

**Check the rule configuration:**

1. Open Settings and find `weevil.notifications`
2. Verify `channel` is set to `"toast"` (not `"status-only"`)
3. Ensure the `value` threshold is reachable with your typical usage

**Debug steps:**

- Rules are debounced — you won't see duplicate toasts
- Run `Weevil: Show Tips` to verify the rule engine is running
- Check the status bar: if it shows data, the rule engine should work

**Example working rule:**

```json
{
  "id": "test-alert",
  "type": "threshold",
  "metric": "cost",
  "scope": "day",
  "value": 0.01,
  "channel": "toast"
}
```

## High Memory Usage

**Normal behavior:**

- Initial log ingestion can use ~50-100MB temporarily
- Memory is released after processing completes

**If memory stays high:**

1. Run `Weevil: Clear Data` to reset and start fresh
2. Reduce `weevil.refreshIntervalMinutes` to reduce processing frequency
3. Check for very large OTel log files (manual log rotation may help)

## Extension Won't Activate

**Symptoms:** Status bar chip doesn't appear, commands not found

**Fixes:**

1. Check VS Code version (requires 1.95.0+)
2. Reinstall the extension
3. Check the Output panel: `View > Output > Extensions`

If activation fails, the Output panel shows the specific error.

## Data Export Produces Empty File

This happens when no events have been recorded yet.

**Fix:** Use Copilot for a few minutes, then run `Weevil: Refresh` before
exporting.

## Multi-Repo Filtering Not Working

Weevil attributes events to repositories using VS Code's built-in Git extension.

**Requirements:**

- Git must be initialized in the workspace
- The repository must be opened as a folder (not just a file)

**Verification:**

1. Open a folder that's a Git repository
2. Check the Source Control view (`Ctrl+Shift+G` / `Cmd+Shift+G`)
3. If Git is active there, Weevil should detect it

## Getting Help

If your issue isn't covered here:

1. Check [GitHub Issues](https://github.com/RedPandaMC/weevil/issues)
2. Create a new issue with:
   - VS Code version
   - Weevil version
   - Operating system
   - Steps to reproduce
   - Relevant log output from the Output panel
