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

The GitHub Copilot base extension (the one that makes API calls) is classified as a UI extension by Microsoft and runs on your **local laptop or desktop**. If you enable Copilot's OpenTelemetry exporter (see [No Copilot usage after install](#no-logs-found)), its usage file is written wherever that extension runs — locally — so Mallard on the remote host cannot read it.

**Result:** Copilot usage shows "No signal yet" or zero, even when you have actively used Copilot in that session.

**Claude Code is not affected.** The `anthropic.claude-code` extension runs on the remote host, writes JSONL session files to `~/.claude/projects/` on the remote, and Mallard reads them from the same path. Claude Code usage is captured normally.

### Workarounds

**Option 1: Install Mallard locally (recommended)**

Open a local (non-remote) VS Code window, install Mallard there, and leave it running. Copilot logs from all of your sessions accumulate in your local log directory, so Mallard will track them continuously without any remote connection involved.

**Option 2: Force-install the Copilot base extension on the remote**

In the Extensions panel, find GitHub Copilot, click the dropdown next to Install, and choose **Install in SSH: \<host\>** (or equivalent for your remote type). Once the base extension runs in the remote exthost, its OTel exporter (once enabled) writes to the remote host where Mallard can read it.

This is not an officially supported configuration by GitHub/Microsoft, but it works in practice for many setups. Inline completions may behave differently since the extension now runs remote.

**Option 3: Point Mallard at a synced log directory**

If you point Copilot's OTel exporter at a file and sync it to the remote (e.g. via `sshfs`, `rclone`, or a cloud drive), set `mallard.copilotOtelPath` to the mount path. Mallard will then read from the synced copy.

## No Copilot usage after install {#no-logs-found}

**Claude Code** is discovered automatically — if it shows nothing, use it once, click **Refresh**, and run **Mallard: Show Detected Log Path** to confirm discovery.

**GitHub Copilot writes no local usage until you enable its OpenTelemetry exporter:**

1. **Enable it.** Run **Mallard: Enable Copilot Usage Tracking** (or accept the prompt / click **Enable Copilot tracking** in the empty state). Mallard sets `github.copilot.chat.otel.exporterType` to `file` and points `otel.outfile` at a file it ingests. Reload the window if prompted, use Copilot once, then click **Refresh**.
2. **No Copilot token?** If you use a BYOK model with no active Copilot subscription, Copilot makes no billable calls and emits no usage. Sign in to GitHub for authoritative billing instead — **Mallard: Sign In to GitHub**.
3. **Custom path.** If you configured the exporter yourself (or want a SQLite span DB), point `mallard.copilotOtelPath` at the JSONL file or `.sqlite`/`.db` database.

## Data cleared after uninstall {#data-cleared}

VS Code does not delete extension storage when you uninstall an extension. Run **Mallard: Prepare for Uninstall** before uninstalling if you want to remove the DuckDB event store and all cached state. Reinstalling without clearing first will restore your historical data.

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
