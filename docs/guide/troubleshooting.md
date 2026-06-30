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

The GitHub Copilot base extension — the one that makes API calls and writes OTel usage telemetry — is classified as a UI extension by Microsoft. It runs on your **local laptop or desktop**, so its log files are written there, not on the remote host. Mallard runs on the remote host and cannot read files from your local machine.

**Result:** Copilot usage shows "No signal yet" or zero, even when you have actively used Copilot in that session.

**Claude Code is not affected.** The `anthropic.claude-code` extension runs on the remote host, writes JSONL session files to `~/.claude/projects/` on the remote, and Mallard reads them from the same path. Claude Code usage is captured normally.

### Workarounds

**Option 1 — Install Mallard locally (recommended)**

Open a local (non-remote) VS Code window, install Mallard there, and leave it running. Copilot logs from all of your sessions accumulate in your local log directory, so Mallard will track them continuously without any remote connection involved.

**Option 2 — Force-install the Copilot base extension on the remote**

In the Extensions panel, find GitHub Copilot, click the dropdown next to Install, and choose **Install in SSH: \<host\>** (or equivalent for your remote type). Once the base extension runs in the remote exthost, it writes OTel logs to the remote host's log directory where Mallard can read them.

This is not an officially supported configuration by GitHub/Microsoft, but it works in practice for many setups. Note that inline completions may behave differently since the extension now runs remote.

**Option 3 — Point Mallard at a synced log directory**

If you sync your local VS Code log directory to the remote (e.g. via `sshfs`, `rclone`, or a cloud drive), set `mallard.copilotLogPath` to the mount path. Mallard will then read from the synced copy.

## No logs found after install {#no-logs-found}

Run **Mallard: Show Detected Log Path** from the Command Palette. If Mallard reports no files found:

1. **Use Copilot first.** Copilot only writes OTel log files when it makes API calls. Open a file, trigger a completion or chat, then click **Refresh** in the Mallard dashboard.
2. **Check the path.** The detected path should be inside VS Code's log directory (e.g. `~/.vscode-server/data/logs` on Linux). If it points somewhere unexpected, set `mallard.copilotLogPath` to override it.
3. **Snap / Flatpak installs.** VS Code installed via Snap or Flatpak uses a sandboxed log path. Mallard includes the standard Snap and Flatpak paths in its search list, but if your install is non-standard, override with `mallard.copilotLogPath`.

## Data cleared after uninstall {#data-cleared}

VS Code does not delete extension storage when you uninstall an extension. Run **Mallard: Clear All Data** before uninstalling if you want to remove the DuckDB event store and all cached state. Reinstalling without clearing first will restore your historical data.
