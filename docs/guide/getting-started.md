# Getting Started

## Prerequisites

- VS Code 1.95 or later
- [GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot) installed and activated

Weevil does **not** require a GitHub sign-in or any API tokens. It reads the OTel log files that Copilot writes to VS Code's own log directory.

## Installation

Install from the VS Code Marketplace:

1. Open VS Code
2. Press `Ctrl+Shift+X` (or `Cmd+Shift+X` on Mac) to open Extensions
3. Search for **Weevil**
4. Click **Install**

Alternatively, install via the CLI:

```bash
code --install-extension RedPandaMC.weevil
```

## First run

Once installed, Weevil activates automatically:

1. A small chip appears in the status bar: `● 0 cr · $0.00`
2. Click the Weevil icon in the activity bar (left sidebar) to open the compact gauge
3. Run **Weevil: Open Dashboard** (`Ctrl+Shift+P` → type "Weevil") for the full view

### Nothing showing up?

If the dashboard shows the empty state ("Nothing tracked yet"), Copilot may not have written any logs yet. Use Copilot normally for a few minutes, then click **Refresh now** inside the dashboard.

To check where Weevil is looking for logs, run **Weevil: Show Detected Log Path** from the command palette. If the path looks wrong, set `weevil.copilotLogPath` to override it.

## What Weevil tracks

Weevil reads Copilot's local [OpenTelemetry](https://opentelemetry.io/) log files. Each log entry contains:

- **Model** — e.g. `gpt-4o`, `claude-sonnet-4`, `o3`
- **Tokens** — input and output token counts
- **Surface** — `chat`, `inline`, `agent`, `edit`
- **Timestamp**

From tokens, Weevil computes credit usage using the same multiplier table Copilot publishes (bundled in the extension and refreshed daily).

Weevil does **not** contact GitHub's API, does not read your code, and does not transmit anything off your machine.
