# Getting Started

## Prerequisites

- VS Code 1.95 or later
- [GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot) and/or Claude Code installed and active

Mallard requires no sign-in or API token: it reads local usage logs these tools already write to disk (Copilot's OTel logs in VS Code's own log directory, Claude Code's JSONL session logs). Install one or both; Mallard tracks whichever it finds.

## Installation

From the Marketplace: open Extensions (`Ctrl+Shift+X`), search **Mallard**, click Install.

Or from the CLI:

```bash
code --install-extension RedPandaMC.mallard
```

## First run

Click the Mallard icon in the activity bar. If the dashboard shows an empty state, use Copilot or Claude Code for a minute then click **Refresh**. Run **Mallard: Show Detected Log Path** to confirm Mallard found the right directory. If Copilot's isn't found, set `mallard.copilotLogPath` to override it; Claude Code's log directory is auto-detected and has no override setting.

## What Mallard tracks

Each Copilot log entry includes the model, input/output token counts, surface (chat, inline, agent, edit), and timestamp. Each Claude Code session entry includes the model, input/output/cache/thinking token counts, surface (agent or chat), and timestamp. Mallard converts tokens to credits using each tool's published multiplier table, bundled in the extension and refreshed daily.

## GitHub billing reconciliation

Run **Mallard: Sign In to GitHub** (or use the dashboard button) to pull the authoritative Copilot charge from GitHub's API. This shows spend across all your machines, not just the current one. Sign-in is optional and never shown at startup. This is Copilot-specific — Anthropic doesn't expose an equivalent user-scoped billing API, so Claude Code spend stays local-log-based (estimated) with or without signing in.

## Uninstalling

VS Code does not delete extension storage on uninstall, so run this one command first:

1. Open the Command Palette and run **Mallard: Prepare for Uninstall**.
2. Confirm the modal. This deletes all events, settings, cached pricing, and secrets.
3. Uninstall Mallard from the Extensions view as usual.
