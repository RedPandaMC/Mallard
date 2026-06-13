<div align="center">
  <img src="media/logo.svg" alt="Weevil" width="120" height="120" />

# Weevil

**Real-time GitHub Copilot cost tracking for VS Code.**

</div>

---

Weevil reads the OpenTelemetry log files GitHub Copilot writes to VS Code's log
directory and turns them into a live picture of your spend: today, month-to-date,
and a projected month-end total, broken down by model, surface, cost type, and
repository. The core features need no sign-in and make no network calls. You can
optionally connect to GitHub's billing API for the authoritative charge.

## Features

- **Status bar chip.** Always-on indicator of today's credits and cost that tints
  from normal to warning to over as you approach your budget. The number is always
  shown, never colour alone. Clicking it opens the dashboard.
- **Dashboard.** A webview with KPI cards (today, month-to-date, projected, top
  model), a spend gauge, a 30-day bar chart with a projected-pace line, a model
  breakdown, a model-to-surface flow chart, and a spend-by-cost-type chart. All
  aggregation happens in the extension host; the webview only paints, and charts
  below the fold initialise lazily.
- **Arrangeable analysis view.** An edit mode lets you drag charts to reorder
  them, scale each between half and full width, and hide the ones you do not use.
  The layout is saved and restored automatically.
- **Budget and alerts, in the UI.** Set a monthly budget, an included-credit
  allowance, a daily credit threshold, and a spending-velocity alert from the
  dashboard. They are stored per user and follow you across machines.
- **Automatic pricing.** Credit multipliers ship with the extension and refresh
  once a day from a known URL, validated before use, with the bundled copy as a
  fallback. A pricing change is a one-line repo update, no user action needed.
- **Workspace aware.** When several repositories are open, Weevil attributes usage
  to the active workspace repo and lets you filter the dashboard per repo.
- **Optional GitHub reconciliation.** Connect with VS Code's built-in GitHub
  session to show the authoritative charge, which aggregates usage across every
  machine you use. Entirely opt-in.
- **Exportable report.** Save a standalone, printable HTML report from the current
  snapshot. It contains no external requests, so it prints to PDF from any
  browser.

## Quick start

1. Install from the Extensions view, or:

   ```bash
   code --install-extension RedPandaMC.weevil
   ```

2. Use Copilot as normal. Weevil starts collecting immediately, no sign-in
   required.

3. Open the dashboard from the Weevil icon in the activity bar, or run
   "Weevil: Open Dashboard" from the Command Palette.

If the dashboard shows "not enough data", Copilot has not written logs yet, or
Weevil cannot find them. Run "Weevil: Show Detected Log Path" to check, and set
`weevil.copilotLogPath` if needed.

## How it works

Copilot writes JSON-lines OTel logs containing the model, input and output token
counts, the surface (chat, inline, agent, edit), and a timestamp. Weevil watches
those files, stores events in a local SQLite database (recent events at full
detail, older ones rolled up to daily rows), and computes a render-ready snapshot
that the status bar, sidebar, and dashboard all consume.

Token counts are estimates, so costs are estimates. For the authoritative number,
connect GitHub billing. The logs expose only input and output token counts per
call, so the spend-by-cost-type chart splits cost into input and output; richer
categories such as tool and reasoning are not available locally.

## Settings

Weevil reads two settings. Budget, included credits, and alert thresholds are
edited in the dashboard, not here.

| Setting | Default | Description |
| --- | --- | --- |
| `weevil.copilotLogPath` | `""` | Override the log directory. Blank means auto-detect via `vscode.env.logUri`. |
| `weevil.pricingManifestUrl` | `""` | Override the pricing manifest URL. Blank means use the built-in URL. |

## Commands

`Weevil: Open Dashboard`, `Refresh Now`, `Clear All Data`, `Show Detected Log
Path`, `Sign In to GitHub`, `Export Monthly Report`.

## Privacy and security

- Usage data lives in your per-user global storage, never in settings or in git.
  "Clear All Data" wipes events, your budget/alert config, the saved layout, and
  the cached pricing manifest. VS Code keeps extension storage after uninstall,
  so run it before removing Weevil to leave nothing behind.
- The webview uses a strict Content-Security-Policy with a per-load nonce: no
  inline scripts, no inline styles, no eval, and no external origins. Messages are
  validated by typed guards in both directions.
- The pricing manifest is fetched with a timeout, validated, and never executed.
- Log paths are validated against known roots; paths containing `..` are rejected.
- No credentials are stored. GitHub sign-in uses VS Code's session API.

## Development

```bash
bun install
bun run compile        # build host and webview bundles
bun run check-types    # type-check both tsconfigs
bun run lint
bun run test:unit      # pure logic tests
bun test               # integration tests in a real VS Code host
```

Press F5 to launch an Extension Development Host.

## License

MIT, Jurrean De Nys
