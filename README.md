<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/brand/readme-banner-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="media/brand/readme-banner-light.png">
  <img src="media/brand/readme-banner-light.png" alt="Mallard, a GitHub Copilot cost tracker for VS Code" width="480" style="max-width:100%" />
</picture>

**Know what GitHub Copilot and Claude Code are costing you — estimated from local logs.**

[![CI](https://github.com/RedPandaMC/Mallard/actions/workflows/ci.yml/badge.svg)](https://github.com/RedPandaMC/Mallard/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/RedPandaMC/Mallard/branch/main/graph/badge.svg)](https://codecov.io/gh/RedPandaMC/Mallard)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

Mallard is a VS Code extension that turns GitHub Copilot's local usage logs into a live cost dashboard: today's spend, month-to-date, and a projected month-end total, broken down by model, surface, cost type, and repository. By default there's nothing to sign into and nothing to configure — install it, use Copilot, and watch the numbers update in real time. Connect GitHub billing later if you want the authoritative charge alongside Mallard's estimate.

Under the hood it's a DuckDB-backed dashboard with branch-aware spend tracking, programmable budget alerts, and an optional restriction popup when a budget runs out, all running locally. No telemetry is collected and no external accounts are required by default; GitHub sign-in and metric export are opt-in.

## What talks to the network

By default, Mallard reads only local log files and sends nothing anywhere. Two background reference fetches are unconditional (no user data is sent):

- **Pricing manifest** — the Copilot credit-multiplier table is fetched daily from `raw.githubusercontent.com/RedPandaMC/mallard/main/media/pricing-manifest.json`. Per-token model prices are fetched from OpenRouter's public `/api/v1/models` endpoint (LiteLLM's community price sheet as fallback).
- **Currency rates** — daily FX rates from `api.frankfurter.app` for display-currency conversion.

If you opt in to metric export, payloads are sent to your self-hosted server only. If you opt in to GitHub billing, the extension calls GitHub's billing API using your token.

## Quick start

1. Install from the Extensions view, or:

   ```bash
   code --install-extension RedPandaMC.mallard
   ```

2. Use Copilot and/or Claude Code normally. Mallard starts collecting right away.

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
bun run test           # integration tests in a real VS Code host
bun run bench          # performance benchmarks (not run in CI)
bun run assets         # regenerate brand rasters from the source SVG art
bun run docs:dev       # preview the documentation site
```

Press F5 to launch an Extension Development Host.

## License

MIT

---

Mallard is an independent project and is not affiliated with, endorsed by, or sponsored by GitHub, Microsoft, or Anthropic. "GitHub Copilot" and "Claude Code" are trademarks of their respective owners.
