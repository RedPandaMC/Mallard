<div align="center">

<img src="media/brand/readme-banner.svg" alt="Mallard" width="480" />

**Know exactly what GitHub Copilot is costing you.**

[![CI](https://github.com/RedPandaMC/Mallard/actions/workflows/ci.yml/badge.svg)](https://github.com/RedPandaMC/Mallard/actions/workflows/ci.yml)
[![Docs](https://github.com/RedPandaMC/Mallard/actions/workflows/docs.yml/badge.svg)](https://github.com/RedPandaMC/Mallard/actions/workflows/docs.yml)
[![Coverage](https://codecov.io/gh/RedPandaMC/Mallard/branch/main/graph/badge.svg)](https://codecov.io/gh/RedPandaMC/Mallard)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

`COPILOT SPEND PLUGIN` — local-first, no sign-in

</div>

---

Mallard reads the OpenTelemetry log files GitHub Copilot writes to VS Code's log
directory and turns them into a live picture of your spend: today, month-to-date,
and a projected month-end total, broken down by model, surface, cost type, and
repository. The core features need no sign-in and make no network calls. You can
optionally connect to GitHub's billing API for the authoritative charge.

### What Mallard reads out

| ch | readout | reads from |
| :-- | :-- | :-- |
| `01` | **live spend** | today / MTD / projected month-end |
| `02` | **model mix** | per-model credits, cost & tokens |
| `03` | **surface flow** | chat · inline · agent · edit |
| `04` | **token cost** | input vs. output split |

## Features

- **Dashboard in the editor.** Click the Mallard icon in the activity bar to open
  the full dashboard: KPI cards (today, month-to-date, projected, top model), a
  spend gauge, a 30-day bar chart with a projected-pace line, a model breakdown, a
  model-to-surface flow chart, and a spend-by-cost-type chart. A pop-out button
  opens the same view in an editor tab. All aggregation happens in the extension
  host; the webview only paints, and charts below the fold initialise lazily.
- **Arrangeable analysis view.** An edit mode lets you drag charts to reorder
  them, scale each between half and full width, and hide the ones you do not use.
  The layout is saved and restored automatically.
- **Budget and alerts.** Set a monthly budget, an included-credit allowance, a
  daily credit threshold, and a spending-velocity alert from the dashboard, or by
  hand-editing a small JSON config file. Either way the change applies live.
- **Custom alert rules.** Write precise rules in `config.json` using a
  JSONLogic-inspired condition language. Rules support every comparison operator,
  `and` / `or` / `not`, cooldowns, group toggles, message templates
  (`{{ today.credits }}`), and user-defined variables. VS Code validates the file
  automatically using a bundled JSON Schema, so you get inline autocompletion and
  hover documentation for every condition operator and context field.
- **Copilot restriction.** Any alert rule can carry a `restrict` block that
  soft-warns or hard-disables Copilot extensions when the condition fires (e.g.
  when the monthly budget is exhausted). A configurable grace period and a
  `reEnableWhen` condition let the restriction lift automatically. Use
  "Mallard: Simulate Restriction" from the Command Palette for a dry run that shows
  exactly which rules would fire without disabling anything.
- **Rule groups.** Group alert rules and enable or disable an entire set at once
  from the dashboard, without deleting the rules. Useful for toggling work-hours
  rules on evenings and weekends.
- **Automatic pricing.** Credit multipliers ship with the extension and refresh
  once a day from a known URL, validated before use, with the bundled copy as a
  fallback. A pricing change is a one-line repo update, no user action needed.
- **Workspace aware.** When several repositories are open, Mallard attributes usage
  to the active workspace repo and lets you filter the dashboard per repo.
- **Branch-aware credit tracking.** Usage is tagged to the current git branch so
  you can see how much a particular feature branch has cost. Set per-branch credit
  caps in `config.json` and Mallard warns when a branch crosses its threshold.
- **Optional GitHub reconciliation.** Connect with VS Code's built-in GitHub
  session to show the authoritative charge, which aggregates usage across every
  machine you use. Entirely opt-in.
- **Exportable report.** Save a standalone, printable HTML report from the current
  snapshot. It contains no external requests, so it prints to PDF from any browser.
- **Metric streaming.** After each snapshot Mallard can publish a JSON usage-vector
  to an MQTT broker (`mqtts://` or `wss://`) over TLS or mTLS. The payload covers
  model distribution, surface distribution, spend velocity, and MTD budget fraction
  — ready for InfluxDB, Grafana, or a vector database for anomaly detection. See
  [Settings reference](docs/reference/settings.md) for broker examples.

## Quick start

1. Install from the Extensions view, or:

   ```bash
   code --install-extension RedPandaMC.mallard
   ```

2. Use Copilot as normal. Mallard starts collecting immediately, no sign-in
   required.

3. Open the dashboard from the Mallard icon in the activity bar, or run
   "Mallard: Open Dashboard" from the Command Palette.

If the dashboard shows "not enough data", Copilot has not written logs yet, or
Mallard cannot find them. Run "Mallard: Show Detected Log Path" to check, and set
`mallard.copilotLogPath` if needed.

## How it works

Copilot writes JSON-lines OTel logs containing the model, input and output token
counts, the surface (chat, inline, agent, edit), and a timestamp. Mallard watches
those files, stores events in a local embedded database (DuckDB; recent events
at full detail, older ones rolled up to daily rows), and computes a render-ready
snapshot that the dashboard (in the sidebar and the pop-out panel) consumes.

Token counts are estimates, so costs are estimates. For the authoritative number,
connect GitHub billing. The logs expose only input and output token counts per
call, so the spend-by-cost-type chart splits cost into input and output; richer
categories such as tool and reasoning are not available locally.

## Settings

Mallard has three core settings; everything else (budget, alerts, rules) is edited
in `config.json` via the "Edit alert rules" button in the dashboard.

| Setting | Default | Description |
| --- | --- | --- |
| `mallard.copilotLogPath` | `""` | Override the log directory. Blank means auto-detect via `vscode.env.logUri`. |
| `mallard.pricingManifestUrl` | `""` | Override the pricing manifest URL. Blank means use the built-in URL. |
| `mallard.palette` | `"swiss"` | Chart palette: `swiss` uses a fixed duotone; `theme` derives the accent from your VS Code theme. |

### Metric export settings

Configure MQTT metric streaming with the `mallard.metricExport.*` group. All
settings are machine-scoped so credentials are not synced across machines.

| Setting | Default | Description |
| --- | --- | --- |
| `mallard.metricExport.brokerUrl` | `""` | MQTT broker URL. Only `mqtts://` and `wss://` (TLS) accepted. Leave empty to disable. |
| `mallard.metricExport.topic` | `"mallard/metrics"` | MQTT topic prefix. A stable instance hash is appended automatically. |
| `mallard.metricExport.username` | `""` | MQTT username (optional). |
| `mallard.metricExport.password` | `""` | MQTT password (machine-scoped, not synced). |
| `mallard.metricExport.certPath` | `""` | Client certificate PEM path for mTLS. |
| `mallard.metricExport.keyPath` | `""` | Client private key PEM path for mTLS. |
| `mallard.metricExport.caPath` | `""` | Broker CA certificate PEM path (pins the CA to prevent MITM). |

See [Settings reference](docs/reference/settings.md) for payload schema and
broker connection examples (Mosquitto, HiveMQ Cloud, EMQX with mTLS).

## Commands

| Command | Description |
| --- | --- |
| `Mallard: Open Dashboard` | Open the dashboard panel in the sidebar or pop-out tab. |
| `Mallard: Refresh Now` | Force an immediate log re-scan and snapshot rebuild. |
| `Mallard: Clear All Data` | Wipe all events, config, layout, and the pricing cache. Run before uninstalling. |
| `Mallard: Show Detected Log Path` | Show where Mallard is looking for Copilot logs. |
| `Mallard: Sign In to GitHub` | Connect GitHub billing for the authoritative usage charge. |
| `Mallard: Export Monthly Report` | Save a standalone, printable HTML report of the current snapshot. |
| `Mallard: Simulate Restriction` | Preview restriction evaluation — shows which rules would fire without actually disabling any extensions. |

## Alert rules quick-start

Click **"Edit alert rules"** in the dashboard to open `config.json` in VS Code's
native JSON editor. The bundled schema wires up autocompletion automatically.

```json
{
  "monthlyBudget": 20,
  "includedCredits": 300,
  "rules": [
    {
      "id": "daily-high",
      "severity": "warning",
      "message": "{{today.credits}} credits used today — slow down.",
      "when": { ">": [{ "var": "today.credits" }, 100] },
      "cooldown": "2h"
    },
    {
      "id": "budget-exhausted",
      "severity": "critical",
      "message": "Monthly budget exhausted — Copilot disabled.",
      "when": { ">=": [{ "var": "budget.percentOfBudget" }, 1] },
      "restrict": {
        "mode": "hard",
        "scope": "copilot",
        "graceMinutes": 10,
        "reEnableWhen": { "<": [{ "var": "budget.percentOfBudget" }, 0.9] }
      }
    }
  ]
}
```

See [Configuration guide](docs/guide/configuration.md) for the full condition
operator reference, context field list, message templates, rule groups, and
user-defined variables.

## Privacy and security

- Usage data lives in your per-user global storage, never in settings or in git.
  "Clear All Data" wipes events, your budget/alert config, the saved layout, and
  the cached pricing manifest. VS Code keeps extension storage after uninstall,
  so run it before removing Mallard to leave nothing behind.
- The webview uses a strict Content-Security-Policy with a per-load nonce: no
  inline scripts, no inline styles, no eval, and no external origins. Messages are
  validated by typed guards in both directions.
- The pricing manifest is fetched with a timeout, validated, and never executed.
- Log paths are validated against known roots; paths containing `..` are rejected.
- MQTT metric export requires TLS (`mqtts://` or `wss://`); plain-text connections
  are rejected with a one-time warning.
- No credentials are stored in VS Code settings sync. The `metricExport.password`
  setting is machine-scoped. GitHub sign-in uses VS Code's session API.

## Development

```bash
bun install
bun run compile        # build host and webview bundles
bun run check-types    # type-check both tsconfigs
bun run lint
bun run test:unit      # pure logic tests (287 tests)
bun run test:coverage  # same tests with c8 coverage report
bun test               # integration tests in a real VS Code host
bun run assets         # regenerate brand rasters from the source SVG art
bun run docs:dev       # preview the documentation site
```

Press F5 to launch an Extension Development Host.

## License

MIT, Jurrean De Nys
