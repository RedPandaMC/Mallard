<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/brand/readme-banner-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="media/brand/readme-banner-light.png">
  <img src="media/brand/readme-banner-light.png" alt="Mallard" width="480" style="max-width:100%" />
</picture>

**Know exactly what GitHub Copilot is costing you.**

[![CI](https://github.com/RedPandaMC/Mallard/actions/workflows/ci.yml/badge.svg)](https://github.com/RedPandaMC/Mallard/actions/workflows/ci.yml)
[![Docs](https://github.com/RedPandaMC/Mallard/actions/workflows/docs.yml/badge.svg)](https://github.com/RedPandaMC/Mallard/actions/workflows/docs.yml)
[![Coverage](https://codecov.io/gh/RedPandaMC/Mallard/branch/main/graph/badge.svg)](https://codecov.io/gh/RedPandaMC/Mallard)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/RedPandaMC.mallard)](https://marketplace.visualstudio.com/items?itemName=RedPandaMC.mallard)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/RedPandaMC.mallard)](https://marketplace.visualstudio.com/items?itemName=RedPandaMC.mallard)
[![Stars](https://img.shields.io/github/stars/RedPandaMC/Mallard?style=flat)](https://github.com/RedPandaMC/Mallard/stargazers)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![DuckDB](https://img.shields.io/badge/DuckDB-embedded-FCD12A?logo=duckdb&logoColor=black)](https://duckdb.org/)
[![Bun](https://img.shields.io/badge/Bun-runtime-F9F1E1?logo=bun&logoColor=black)](https://bun.sh/)
[![security: bandit](https://img.shields.io/badge/security-bandit-yellow.svg)](https://github.com/PyCQA/bandit)

`COPILOT SPEND PLUGIN` · local-first, no sign-in

</div>

---

Mallard reads the OpenTelemetry logs Copilot writes to VS Code's log directory and builds a live cost breakdown: today, month-to-date, and a projected month-end total, split by model, surface, cost type, and repository. No sign-in required. Connect GitHub billing if you want the authoritative charge.

- **No sign-in required.** Reads OTel logs Copilot already writes to disk.
- **DuckDB-backed.** Full event detail for 90 days; older events roll up to daily rows automatically.
- **Branch-aware.** Tags every event to the active git branch and repo, with per-branch credit caps.
- **Programmable alerts.** JSONLogic condition language with cooldowns, group toggles, and message templates; validated by a bundled JSON Schema.
- **Copilot restriction.** Rules can show soft (dismissable/snoozeable) or hard (persistent, re-fires every refresh) popups when a budget is exhausted.
- **Metric streaming.** Push a metric payload to an MQTT broker or HTTP webhook after each snapshot.
- **Printable export.** Self-contained HTML report, PDF-ready in any browser.
- **GitHub billing reconciliation.** Opt-in: authoritative charge across all your machines.

## Quick start

1. Install from the Extensions view, or:

   ```bash
   code --install-extension RedPandaMC.mallard
   ```

2. Use Copilot normally. Mallard starts collecting right away.

3. Open the dashboard from the Mallard icon in the activity bar, or run
   "Mallard: Open Dashboard" from the Command Palette.

If the dashboard shows "not enough data", run "Mallard: Show Detected Log Path" to check,
and set `mallard.copilotLogPath` if needed.

## How it works

Copilot writes JSON-lines OTel logs with the model name, input/output token counts,
surface, and a timestamp. Mallard watches those files, stores events in a local DuckDB
database, and computes a render-ready snapshot for the dashboard.

Token counts are estimates. Connect GitHub billing for the authoritative charge. Costs
are split into input and output; richer categories such as tool and reasoning are not
available in the local logs.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `mallard.copilotLogPath` | `""` | Override the log directory. Blank = auto-detect. |
| `mallard.pricingManifestUrl` | `""` | Override the pricing manifest URL. Blank = built-in. |
| `mallard.palette` | `"swiss"` | Chart palette: `swiss` = fixed duotone; `theme` = VS Code theme. |

Metric export (MQTT and HTTP webhook) is configured under `mallard.metricExport.*`.
See [Settings reference](docs/reference/settings.md) for the full schema and examples.

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

See [Configuration guide](docs/guide/configuration.md) for the full operator reference,
context field list, message templates, rule groups, and user-defined variables.

## Privacy and security

- Usage data lives in per-user global storage, never in settings or git.
  Run **Mallard: Prepare for Uninstall** before removing the extension to wipe all data. VS Code does not delete extension storage on uninstall.
- The webview uses a strict Content-Security-Policy with a per-load nonce:
  no inline scripts, no eval, no external origins.
- MQTT metric export requires TLS; plain-text connections are rejected.
- The metric payload contains no repo names, branch names, or user identifiers.
- GitHub sign-in uses VS Code's session API; credentials are never synced.

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
| **Tests** | Mocha + C8 · tsx benchmark suite |
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
bun run bench          # performance benchmarks (not run in CI)
bun run assets         # regenerate brand rasters from the source SVG art
bun run docs:dev       # preview the documentation site
```

Press F5 to launch an Extension Development Host.

## License

MIT, Jurrean De Nys
