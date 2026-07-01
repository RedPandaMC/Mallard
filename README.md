<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/brand/readme-banner-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="media/brand/readme-banner-light.png">
  <img src="media/brand/readme-banner-light.png" alt="Mallard, a GitHub Copilot cost tracker for VS Code" width="480" style="max-width:100%" />
</picture>

**Know exactly what GitHub Copilot is costing you.**

[![CI](https://github.com/RedPandaMC/Mallard/actions/workflows/ci.yml/badge.svg)](https://github.com/RedPandaMC/Mallard/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/RedPandaMC/Mallard/branch/main/graph/badge.svg)](https://codecov.io/gh/RedPandaMC/Mallard)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/RedPandaMC.mallard)](https://marketplace.visualstudio.com/items?itemName=RedPandaMC.mallard)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/RedPandaMC.mallard)](https://marketplace.visualstudio.com/items?itemName=RedPandaMC.mallard)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

Mallard is a VS Code extension that turns GitHub Copilot's local usage logs into a live cost dashboard: today's spend, month-to-date, and a projected month-end total, broken down by model, surface, cost type, and repository. There's nothing to sign into and nothing to configure. Install it, use Copilot, and watch the numbers update in real time. Connect GitHub billing later if you want the authoritative charge alongside Mallard's estimate.

Under the hood it's a DuckDB-backed dashboard with branch-aware spend tracking, programmable budget alerts, and optional Copilot restriction when a budget runs out, all running locally, with no telemetry and no external accounts required.

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

## Documentation

The [documentation site](https://redpandamc.github.io/Mallard/) has the full picture:

- [Features](https://redpandamc.github.io/Mallard/guide/features): everything Mallard tracks and alerts on
- [Getting started](https://redpandamc.github.io/Mallard/guide/getting-started): installation and first-run walkthrough
- [Configuration](https://redpandamc.github.io/Mallard/guide/configuration): budgets, alert rules, and restriction modes
- [Self-hosting](https://redpandamc.github.io/Mallard/guide/self-hosting): the optional BYO server for cross-machine reporting
- [Troubleshooting](https://redpandamc.github.io/Mallard/guide/troubleshooting): fixes for common setup issues
- [Settings](https://redpandamc.github.io/Mallard/reference/settings), [Commands](https://redpandamc.github.io/Mallard/reference/commands), and [Alert rules](https://redpandamc.github.io/Mallard/reference/alert-rules) reference

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
