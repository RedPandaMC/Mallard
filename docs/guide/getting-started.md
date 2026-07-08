# Getting Started

## Prerequisites

- VS Code 1.95 or later
- [GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot) and/or Claude Code installed and active

Mallard reads local usage logs these tools write to disk — no sign-in or API token required. **Claude Code** works out of the box (Mallard auto-discovers its JSONL session logs). **GitHub Copilot does not write local usage by default**: you enable its OpenTelemetry exporter once and Mallard ingests the resulting file. Install one or both; Mallard tracks whichever it finds. Prefer zero setup? Sign in to GitHub for authoritative Copilot billing instead (see below).

## Installation

From the Marketplace: open Extensions (`Ctrl+Shift+X`), search **Mallard**, click Install.

Or from the CLI:

```bash
code --install-extension RedPandaMC.mallard
```

## First run

Click the Mallard icon in the activity bar.

- **Claude Code** is tracked automatically — use it for a minute, then click **Refresh**. Run **Mallard: Show Detected Log Path** to confirm discovery.
- **GitHub Copilot** writes no local usage until you turn on its OpenTelemetry exporter. When Copilot is installed but the exporter is off, Mallard shows a one-time prompt and an **Enable Copilot tracking** button in the empty state. Accept it, or run **Mallard: Enable Copilot Usage Tracking** from the Command Palette — Mallard sets `github.copilot.chat.otel.exporterType` to `file` and points `otel.outfile` at a file it then ingests. (You may be asked to reload the window.) To do it manually, or to read a SQLite span DB, set those Copilot settings yourself or point `mallard.copilotOtelPath` at the JSONL/`.sqlite` file.

No structured Copilot usage on disk (e.g. you use a BYOK model with no Copilot token)? Sign in to GitHub for billing data instead — see below.

## What Mallard tracks

Each Copilot log entry includes the model, input/output token counts, surface (chat, inline, agent, edit), and timestamp. Each Claude Code session entry includes the model, input/output/cache/thinking token counts, surface (agent or chat), and timestamp. Mallard converts tokens to credits using each tool's published multiplier table, bundled in the extension and refreshed daily.

## GitHub billing reconciliation

Run **Mallard: Sign In to GitHub** (or use the dashboard button) to pull the authoritative Copilot charge from GitHub's API. This shows spend across all your machines, not just the current one. Sign-in is optional and never shown at startup. This is Copilot-specific — Anthropic doesn't expose an equivalent user-scoped billing API, so Claude Code spend stays local-log-based (estimated) with or without signing in.

## Where your data lives

Ingested usage is stored in a local DuckDB database in the extension's storage directory and persists across VS Code restarts — history stays intact even after the source logs rotate away. If the numbers ever look wrong, **Mallard: Rebuild Ingested Data** wipes the recorded usage and re-parses every log from scratch.

## Uninstalling

VS Code does not delete extension storage on uninstall, so run this one command first:

1. Open the Command Palette and run **Mallard: Prepare for Uninstall**.
2. Confirm the modal. This deletes all events, settings, cached pricing, and secrets.
3. Uninstall Mallard from the Extensions view as usual.
