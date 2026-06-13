# Getting Started

## Prerequisites

- VS Code 1.95 or later
- [GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot)
  installed and in use

Weevil does not require a GitHub sign-in or any API token for its core features.
It reads the OTel log files Copilot writes to VS Code's own log directory.

## Installation

From the Marketplace:

1. Open VS Code
2. Press `Ctrl+Shift+X` (or `Cmd+Shift+X`) to open Extensions
3. Search for Weevil
4. Click Install

Or from the CLI:

```bash
code --install-extension RedPandaMC.weevil
```

## First run

Weevil activates automatically:

1. A small chip appears in the status bar showing today's credits and cost
2. Click the Weevil icon in the activity bar for the compact view
3. Run "Weevil: Open Dashboard" for the full view

If the dashboard shows the empty state, Copilot may not have written logs yet.
Use Copilot for a few minutes, then click Refresh in the dashboard. To see where
Weevil is looking, run "Weevil: Show Detected Log Path". If the path is wrong,
set `weevil.copilotLogPath`.

## What Weevil tracks

Each Copilot OTel log entry contains:

- Model, for example `gpt-4o`, `claude-sonnet-4`, `o3`
- Input and output token counts
- Surface: chat, inline, agent, or edit
- Timestamp

From tokens Weevil computes credit usage with the same multiplier table Copilot
publishes, bundled in the extension and refreshed daily. Where both token counts
are present it also splits each request's cost into input and output so the
dashboard can show spend by cost type.

When more than one repository is open, Weevil attributes usage to the active
workspace repo at the time it reads each batch of log entries, so you can filter
the dashboard per repo.

## Optional: GitHub billing reconciliation

Weevil can connect to GitHub's billing API to show the authoritative charge next
to the local estimate. Run "Weevil: Sign In to GitHub" or use the button in the
dashboard. If you are already signed in to GitHub in VS Code this often succeeds
without a prompt.

Once connected, the dashboard shows a connected status with the actual charge and
the quota reset date. Because GitHub bills across every machine you use, the API
total can be higher than a single machine's local estimate.

The integration is opt-in and quiet by default; Weevil never shows a sign-in
modal at startup. It reads only your credit usage and billing totals, not your
code or repositories. To sign out, revoke the VS Code GitHub session from
Accounts in the activity bar.
