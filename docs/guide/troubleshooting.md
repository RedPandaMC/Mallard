# Troubleshooting

## Remote SSH / Remote Tunnels {#remote-ssh}

### GitHub Copilot usage not showing up

When you connect to a remote machine via VS Code Remote SSH (or Remote Tunnels), VS Code splits extensions between the **local** side and the **remote** side:

| Extension | Runs on | Writes logs to |
| --- | --- | --- |
| `github.copilot` (base) | **Local** client | Local machine |
| `github.copilot-chat` | Remote host | Remote host |
| `anthropic.claude-code` | Remote host | Remote host |
| `mallard` | Remote host | Remote host |

The GitHub Copilot base extension (the one that makes API calls and writes OTel usage telemetry) is classified as a UI extension by Microsoft. It runs on your **local laptop or desktop**, so its log files are written there, not on the remote host. Mallard runs on the remote host and cannot read files from your local machine.

**Result:** Copilot usage shows "No signal yet" or zero, even when you have actively used Copilot in that session.

**Claude Code is not affected.** The `anthropic.claude-code` extension runs on the remote host, writes JSONL session files to `~/.claude/projects/` on the remote, and Mallard reads them from the same path. Claude Code usage is captured normally.

### Workarounds

**Option 1: Install Mallard locally (recommended)**

Open a local (non-remote) VS Code window, install Mallard there, and leave it running. Copilot logs from all of your sessions accumulate in your local log directory, so Mallard will track them continuously without any remote connection involved.

**Option 2: Force-install the Copilot base extension on the remote**

In the Extensions panel, find GitHub Copilot, click the dropdown next to Install, and choose **Install in SSH: \<host\>** (or equivalent for your remote type). Once the base extension runs in the remote exthost, it writes OTel logs to the remote host's log directory where Mallard can read them.

This is not an officially supported configuration by GitHub/Microsoft, but it works in practice for many setups. Inline completions may behave differently since the extension now runs remote.

**Option 3: Point Mallard at a synced log directory**

If you sync your local VS Code log directory to the remote (e.g. via `sshfs`, `rclone`, or a cloud drive), set `mallard.copilotLogPath` to the mount path. Mallard will then read from the synced copy.

## No logs found after install {#no-logs-found}

Run **Mallard: Show Detected Log Path** from the Command Palette. If Mallard reports no files found:

1. **Use Copilot first.** Copilot only writes OTel log files when it makes API calls. Open a file, trigger a completion or chat, then click **Refresh** in the Mallard dashboard.
2. **Check the path.** The detected path should be inside VS Code's log directory (e.g. `~/.vscode-server/data/logs` on Linux). If it points somewhere unexpected, set `mallard.copilotLogPath` to override it.
3. **Snap / Flatpak installs.** VS Code installed via Snap or Flatpak uses a sandboxed log path. Mallard includes the standard Snap and Flatpak paths in its search list, but if your install is non-standard, override with `mallard.copilotLogPath`.

## Data cleared after uninstall {#data-cleared}

VS Code does not delete extension storage when you uninstall an extension. Run **Mallard: Clear All Data** before uninstalling if you want to remove the DuckDB event store and all cached state. Reinstalling without clearing first will restore your historical data.

## Alert rule not firing {#rule-not-firing}

Rules are skipped silently when any of these conditions are true:

**Cooldown not elapsed**: the default cooldown is 1 hour even if you don't set one. A rule that fired recently won't fire again until the cooldown window passes. Set a shorter `cooldown` (e.g. `"5m"`) while testing, then restore it.

**`active` condition is false**: if your rule has an `active` field, the rule is skipped entirely when that condition evaluates to false. Check it separately from `when`.

**Rule is snoozed**: clicking Snooze on a notification suppresses that rule until the snooze expires. There is no UI to clear a snooze early; edit the rule's `id` to reset its state, then change it back.

**`when` condition not met**: use **Mallard: Simulate Restriction State** from the Command Palette to see which rule (if any) would be active right now against the live snapshot. The output channel prints the full evaluation result as JSON.

## Metric export disabled {#export-disabled}

If the Output panel (`View → Output → Mallard`) shows a warning that export is disabled:

**Webhook**: `mallard.server.url` must use `https://`. Plain `http://` is rejected at startup. Export stays disabled until you set a secure URL.

**MQTT**: `mallard.mqtt.url` must use `mqtts://` or `wss://`. Plain `mqtt://` is rejected. Both schemes are TLS-wrapped; use whichever your broker exposes.

**4xx response from the server**: a `401` or `403` means the credential is wrong or missing. A `400` means the payload failed validation. Check the Output panel for the exact status code; 4xx errors are not retried.

**mTLS with only one of cert/key set**: both `mallard.shared.certificate.file` and `mallard.shared.certificate.keyFile` must be set together. Setting only one is logged as a warning and mTLS is skipped.

## MQTT password not working on a new machine {#mqtt-password-sync}

The MQTT password is stored in VS Code's SecretStorage, which is a local machine vault and is **not** synced by Settings Sync. The username (`mallard.mqtt.username`) and all other settings sync normally, but the password must be re-entered on each machine.

Run **Mallard: Set MQTT Export Password** from the Command Palette on the new machine.

## Snapshot looks stale {#snapshot-stale}

Mallard rebuilds the snapshot every 10 minutes by default (configurable with `mallard.refreshIntervalMinutes`). Between refreshes the dashboard shows the last computed snapshot.

Run **Mallard: Refresh Now** to force an immediate re-scan and recompute. If the dashboard still doesn't update, check the Output panel for ingest errors: a file that Mallard cannot read (permissions, lock) is skipped silently and logged there.

If the snapshot permanently shows zero after previously showing data, check whether VS Code moved its log directory (e.g. after an update or profile change). Run **Mallard: Show Detected Log Path** to confirm Mallard is still watching the right directory.

## Branch not detected {#branch-not-detected}

Mallard reads the active branch from VS Code's built-in Git extension. Branch detection returns nothing when:

- **Detached HEAD**: `git checkout <commit>` or a rebase in progress puts the repo in detached state. No branch name is available until you check out a branch.
- **No file open in a git repo**: Mallard uses the active editor's workspace folder to resolve the repository. With no editor open, it falls back to the first open repository. If no repository is open at all, branch is `undefined`.
- **Git extension disabled**: if the built-in `vscode.git` extension is disabled or fails to activate, Mallard cannot read branch state.

Events without a detected branch are stored with `branch = null` and excluded from per-branch budget checks.

## Claude Code usage not showing {#claude-code-not-showing}

Claude Code usage is read from `~/.claude/projects/` (JSONL session files). This is separate from Copilot log detection and has no auto-detection fallback. If that directory doesn't exist or is empty, no Claude Code data appears.

Check that `~/.claude/projects/` exists and contains `.jsonl` files from recent sessions. Claude Code writes session files there automatically; if the directory is missing, Claude Code has not run yet or ran with a different home directory.

Claude Code usage is attributed to a workspace by matching the session's workspace path hash to your open folders. Sessions run outside any VS Code workspace folder are stored but may not be attributed to a specific repo.
