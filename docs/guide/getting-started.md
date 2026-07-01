# Getting Started

## Prerequisites

- VS Code 1.95 or later
- [GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot) installed and active

Mallard requires no sign-in or API token: it reads OTel log files Copilot writes to VS Code's own log directory.

## Installation

From the Marketplace: open Extensions (`Ctrl+Shift+X`), search **Mallard**, click Install.

Or from the CLI:

```bash
code --install-extension RedPandaMC.mallard
```

## First run

Click the Mallard icon in the activity bar. If the dashboard shows an empty state, use Copilot for a minute then click **Refresh**. Run **Mallard: Show Detected Log Path** to confirm Mallard found the right directory. If not, set `mallard.copilotLogPath` to override it.

## What Mallard tracks

Each Copilot log entry includes the model, input/output token counts, surface (chat, inline, agent, edit), and timestamp. Mallard converts tokens to credits using Copilot's published multiplier table, bundled in the extension and refreshed daily.

## GitHub billing reconciliation

Run **Mallard: Sign In to GitHub** (or use the dashboard button) to pull the authoritative charge from GitHub's API. This shows spend across all your machines, not just the current one. Sign-in is optional and never shown at startup.

## Uninstalling

VS Code does not delete extension storage on uninstall, so run this one command first:

1. Open the Command Palette and run **Mallard: Prepare for Uninstall**.
2. Confirm the modal. This deletes all events, settings, cached pricing, and secrets.
3. Uninstall Mallard from the Extensions view as usual.
