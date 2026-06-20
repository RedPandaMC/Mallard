<div align="center">

<img src="media/brand/readme-banner.svg" alt="Mallard" width="480" style="max-width:100%" />

**Know exactly what GitHub Copilot is costing you.**

[![CI](https://github.com/RedPandaMC/Mallard/actions/workflows/ci.yml/badge.svg)](https://github.com/RedPandaMC/Mallard/actions/workflows/ci.yml)
[![Docs](https://github.com/RedPandaMC/Mallard/actions/workflows/docs.yml/badge.svg)](https://github.com/RedPandaMC/Mallard/actions/workflows/docs.yml)
[![Coverage](https://codecov.io/gh/RedPandaMC/Mallard/branch/main/graph/badge.svg)](https://codecov.io/gh/RedPandaMC/Mallard)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

`COPILOT SPEND PLUGIN` — local-first, no sign-in

</div>

---

Mallard reads the OpenTelemetry logs Copilot writes to VS Code's log directory
and builds a live cost breakdown: today, month-to-date, and a projected
month-end total, split by model, surface, cost type, and repository. Core
features work offline with no sign-in. You can optionally connect to GitHub's
billing API for the authoritative charge.

### What Mallard reads out

| ch | readout | reads from |
| :-- | :-- | :-- |
| `01` | **live spend** | today / MTD / projected month-end |
| `02` | **model mix** | per-model credits, cost & tokens |
| `03` | **surface flow** | chat · inline · agent · edit |
| `04` | **token cost** | input vs. output split |

## Why Mallard

GitHub's billing dashboard shows your total charge. Mallard shows you *where*
it went and *when* — live, locally, without opening a browser.

- **No sign-in required.** Reads OTel logs Copilot already writes to disk.
- **DuckDB-backed.** Full event detail for the last 90 days; older events roll
  up to daily rows. Survives restarts, starts instantly.
- **Branch-aware.** Tags every event to the active git branch and repo. Set
  per-branch credit caps and Mallard warns when a branch crosses its threshold.
- **MQTT metric streaming.** Push an expanded metric payload to any MQTT
  broker (`mqtts://` or `wss://`) after each snapshot — ready for InfluxDB,
  Grafana, or a vector database.
- **Programmable alerts.** Write rules in `config.json` with a JSONLogic
  condition language: comparison operators, `and`/`or`/`not`, cooldowns,
  group toggles, message templates, and user-defined variables. VS Code
  validates the file with a bundled JSON Schema.
- **Copilot restriction.** Alert rules can hard-disable Copilot extensions
  when a budget is exhausted, with a grace period and an auto-re-enable
  condition.
- **Drag-and-arrange dashboard.** Reorder, resize, or hide any chart panel.
  The layout saves automatically.
- **Printable HTML export.** No external requests — exports to PDF in any
  browser.
- **GitHub billing reconciliation.** Opt-in: connect via VS Code's GitHub
  session to see the authoritative charge across all your machines.

## Features

- **Dashboard in the editor.** Click the Mallard icon in the activity bar to
  open the full dashboard: KPI cards (today, MTD, projected, top model), a
  spend gauge, a 30-day bar chart with a projected-pace line, model breakdown,
  model-to-surface flow chart, and spend-by-cost-type chart. Pop-out button
  opens the same view in an editor tab. All aggregation runs in the extension
  host; charts load on scroll.
- **Arrangeable analysis view.** Edit mode: drag charts to reorder, scale
  between half and full width, and hide unused panels. Layout is saved and
  restored automatically. Declare a default layout in `config.json` using CSS
  grid syntax (`gridColumn: "span 2"`).
- **Budget and alerts.** Set a monthly budget, included-credit allowance,
  daily credit threshold, and spending-velocity alert from the dashboard or
  in `config.json`. Changes apply live.
- **Custom alert rules.** Write rules in `config.json` with comparison
  operators, `and`/`or`/`not`, cooldowns, group toggles, message templates
  (`{{ today.credits }}`), and user-defined variables. VS Code validates the
  file with a bundled JSON Schema — inline autocompletion and hover docs for
  every operator and context field.
- **Copilot restriction.** Any alert rule can carry a `restrict` block that
  soft-warns or hard-disables Copilot extensions when the condition fires.
  A configurable grace period and `reEnableWhen` condition let it lift
  automatically. "Mallard: Simulate Restriction" in the Command Palette runs
  a dry-run — shows which rules would fire without disabling anything.
- **Rule groups.** Group alert rules and toggle an entire set at once from the
  dashboard. Useful for switching off work-hours rules on evenings and weekends.
- **Automatic pricing.** Credit multipliers ship with the extension and refresh
  daily from a known URL, validated before use, with the bundled copy as
  fallback. A pricing change is a one-line repo update.
- **Workspace aware.** Multiple repos open? Mallard attributes usage to the
  active workspace repo and lets you filter the dashboard per repo.
- **Branch-aware credit tracking.** Usage is tagged to the current git branch.
  Set per-branch credit caps in `config.json`.
- **Optional GitHub reconciliation.** Connect GitHub billing for the
  authoritative charge, which aggregates usage across every machine you use.
  Entirely opt-in.
- **Exportable report.** Save a standalone HTML report from the current
  snapshot. No external requests — PDF export works in any browser.
- **Metric streaming.** After each snapshot Mallard can push a metric payload
  to an MQTT broker (`mqtts://` or `wss://`) over TLS or mTLS. The payload
  includes model distribution, surface distribution, spend velocity, MTD budget
  fraction, hourly peak, and forecast bounds. See
  [Settings reference](docs/reference/settings.md) for broker examples.

## Quick start

1. Install from the Extensions view, or:

   ```bash
   code --install-extension RedPandaMC.mallard
   ```

2. Use Copilot normally. Mallard starts collecting right away — no sign-in
   required.

3. Open the dashboard from the Mallard icon in the activity bar, or run
   "Mallard: Open Dashboard" from the Command Palette.

If the dashboard shows "not enough data", Copilot has not written logs yet or
Mallard cannot find them. Run "Mallard: Show Detected Log Path" to check, and
set `mallard.copilotLogPath` if needed.

## How it works

Copilot writes JSON-lines OTel logs with the model name, input and output token
counts, surface (chat, inline, agent, edit), and a timestamp. Mallard watches
those files, stores events in a local embedded database (DuckDB — recent events
at full detail, older events rolled up to daily rows), and computes a
render-ready snapshot for the dashboard.

Token counts are estimates, so costs are estimates. For the authoritative
number, connect GitHub billing. The logs expose only input and output token
counts per call, so the spend-by-cost-type chart splits cost into input and
output; richer categories such as tool and reasoning are not available locally.

## Settings

Mallard has three VS Code settings; everything else (budget, alerts, rules) is
edited in `config.json` via "Edit alert rules" in the dashboard.

| Setting | Default | Description |
| --- | --- | --- |
| `mallard.copilotLogPath` | `""` | Override the log directory. Blank = auto-detect. |
| `mallard.pricingManifestUrl` | `""` | Override the pricing manifest URL. Blank = built-in. |
| `mallard.palette` | `"swiss"` | Chart palette: `swiss` = fixed duotone; `theme` = derived from VS Code theme. |

### Metric export settings

Configure MQTT metric streaming with `mallard.metricExport.*`. All settings
are machine-scoped so credentials are never synced.

| Setting | Default | Description |
| --- | --- | --- |
| `mallard.metricExport.brokerUrl` | `""` | MQTT broker URL. Only `mqtts://` and `wss://` accepted. Empty = disabled. |
| `mallard.metricExport.topic` | `"mallard/v2/metrics"` | MQTT topic prefix. A stable instance hash is appended. |
| `mallard.metricExport.username` | `""` | MQTT username (optional). |
| `mallard.metricExport.password` | `""` | MQTT password (machine-scoped, not synced). |
| `mallard.metricExport.certPath` | `""` | Client certificate PEM path for mTLS. |
| `mallard.metricExport.keyPath` | `""` | Client private key PEM path for mTLS. |
| `mallard.metricExport.caPath` | `""` | Broker CA certificate PEM path (CA pinning). |

See [Settings reference](docs/reference/settings.md) for payload schema and
broker connection examples.

## Commands

| Command | Description |
| --- | --- |
| `Mallard: Open Dashboard` | Open the dashboard in the sidebar or pop-out tab. |
| `Mallard: Refresh Now` | Force a log re-scan and snapshot rebuild. |
| `Mallard: Clear All Data` | Wipe all events, config, layout, and the pricing cache. |
| `Mallard: Show Detected Log Path` | Show where Mallard is looking for Copilot logs. |
| `Mallard: Sign In to GitHub` | Connect GitHub billing for the authoritative usage charge. |
| `Mallard: Export Monthly Report` | Save a standalone HTML report of the current snapshot. |
| `Mallard: Simulate Restriction` | Dry-run restriction evaluation — shows which rules would fire. |

## Alert rules quick-start

Click **"Edit alert rules"** in the dashboard to open `config.json`. The
bundled schema wires up autocompletion automatically.

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

- Usage data lives in per-user global storage, never in settings or git.
  "Clear All Data" wipes events, config, layout, and the cached pricing
  manifest. VS Code keeps extension storage after uninstall, so run it before
  removing Mallard.
- The webview uses a strict Content-Security-Policy with a per-load nonce: no
  inline scripts, no inline styles, no eval, no external origins. Messages are
  validated by typed guards in both directions.
- The pricing manifest is fetched with a timeout, validated, and never executed.
- Log paths are validated against known roots; paths with `..` are rejected.
- MQTT metric export requires TLS (`mqtts://` or `wss://`); plain-text
  connections are rejected with a warning.
- No credentials are stored in VS Code settings sync. `metricExport.password`
  is machine-scoped. GitHub sign-in uses VS Code's session API.
- The metric payload contains no repo names, branch names, or user identifiers.
  Only aggregated counts and anonymous fractions are exported.

## Built with

| | |
| --- | --- |
| **Runtime** | TypeScript 5 · VS Code Extension API |
| **Storage** | DuckDB (embedded SQL, N-API bindings) |
| **Charts** | Apache ECharts 5 |
| **State** | Zustand · Preact Signals |
| **Validation** | Zod 4 |
| **Metrics export** | MQTT 5 (`mqtts`/`wss`, mTLS) |
| **Bundler** | esbuild |
| **Tests** | Mocha + C8 |
| **Docs** | VitePress |

## Development

```bash
bun install
bun run compile        # build host and webview bundles
bun run check-types    # type-check both tsconfigs
bun run lint
bun run test:unit      # pure logic tests
bun run test:coverage  # tests with c8 coverage report
bun test               # integration tests in a real VS Code host
bun run assets         # regenerate brand rasters from the source SVG art
bun run docs:dev       # preview the documentation site
```

Press F5 to launch an Extension Development Host.

## License

MIT, Jurrean De Nys
