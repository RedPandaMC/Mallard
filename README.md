<div align="center">
  <img src="media/logo.svg" alt="Weevil" width="120" height="120" />

  # Weevil

  **A little nosey about your Copilot spend.**

  Token, credit, and cost tracking for GitHub Copilot — right inside VS Code.
</div>

---

Weevil watches how you use GitHub Copilot and turns it into an at-a-glance
picture of your spend: hourly, daily, weekly, monthly, quarterly, and yearly —
broken down by model and by repository, with a month-end forecast so overage
never surprises you.

## Features

- **Always-on status bar indicator** — a circular `$(circle-filled)` spend chip
  that tints from normal → warning → over as you approach your budget. The
  number is always shown (never color-only), and a click opens a full
  breakdown.
- **Full dashboard** — a GitKraken-style webview with:
  - Usage-over-time chart with a granularity switcher (hour → year)
  - Spend-by-model donut and spend-by-repository bar chart
  - KPI cards: current scope, month-to-date, projected month-end (with a
    confidence band), budget pace, top model, top repo
  - A metric toggle (cost / credits / tokens) and per-repo filter
- **`@weevil` chat participant** — ask `@weevil today`, `/forecast`, `/models`,
  `/repos`, or `/tips` for exact numbers. Because Weevil owns these requests, the
  per-conversation token counts are **exact**, not estimated.
- **Configurable notifications** — extensible threshold and velocity rules that
  can be scoped/filtered to a specific model, repo, or surface; debounced so you
  get one toast per rule per cooldown, never spam.
- **Multi-repo aware** — open a `.code-workspace` with several repositories and
  Weevil attributes every event to the right repo (via the built-in Git
  extension), so you can view totals globally or filter to one repo.
- **Cost-saving tips** — contextual nudges (right-size the model, prefer inline
  for one-liners, watch agent loops) surfaced in the dashboard and via
  `@weevil /tips`.

## Data sources

Copilot's native usage is **not observable** to third-party extensions, so
Weevil combines what *is* available and always falls back gracefully:

| Source | Accuracy | When it's used |
| --- | --- | --- |
| `@weevil` conversations | **Exact** (counted with the model's own tokenizer) | Whenever you talk to `@weevil` |
| Local Copilot OTel logs | Estimated | When the logs are present on disk |
| Sample data | Synthetic | Fallback so the dashboard always renders |
| GitHub billing | — | Designed and stubbed; no stable per-user endpoint exists yet |

This keeps Weevil fully functional with **no sign-in required**. Optional GitHub
sign-in is wired for future calibration; your token is stored only in the OS
keychain (`SecretStorage`), never in settings or on disk.

## Privacy & security

- Usage data lives in your per-user global storage — never written to settings
  or committed to git. `Weevil: Export Data` and `Weevil: Clear Data` give you
  full control.
- The webview uses a strict Content-Security-Policy with a per-load nonce; no
  inline scripts, no `eval`, and messages are validated by typed guards in both
  directions.
- Secrets (if you sign in) live only in `SecretStorage` (the OS keychain).

## Accessibility

- Granularity tabs are a real `role="tablist"` with arrow-key navigation and
  visible focus rings.
- Charts carry `role="img"` with descriptive labels.
- Meaning is never color-only — the status bar always shows the number and
  budget pace is labeled in text.
- `prefers-reduced-motion` disables animations; all colors derive from
  `--vscode-*` theme tokens for contrast across light, dark, and high-contrast.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `weevil.dataSource` | `auto` | `auto`, `sample`, or `local` |
| `weevil.monthlyBudget` | `0` | Monthly budget in your currency (0 = off) |
| `weevil.currency` | `USD` | Currency code for cost formatting |
| `weevil.pricePerCredit` | `0.04` | Price of one premium request credit |
| `weevil.includedCredits` | `300` | Premium requests included in your plan |
| `weevil.tokenPricing` | `{}` | Per-model credit-multiplier overrides |
| `weevil.refreshIntervalMinutes` | `15` | How often to re-ingest local logs |
| `weevil.statusBar.metric` | `cost` | `cost`, `credits`, or `tokens` |
| `weevil.statusBar.scope` | `today` | `session`, `today`, `workspace`, or `repo` |
| `weevil.notifications` | `[]` | Array of threshold/velocity rules |

### Notification rules

```jsonc
"weevil.notifications": [
  { "id": "daily-cost", "type": "threshold", "metric": "cost",    "scope": "day",  "value": 5,  "channel": "toast" },
  { "id": "burn-rate",  "type": "velocity",  "metric": "credits", "window": "1h",  "value": 50, "filter": { "models": ["o3"] } }
]
```

`type` is `threshold` (a metric crosses `value` within a `scope`) or `velocity`
(a metric exceeds `value` within a rolling `window`). `filter` reuses Weevil's
standard filter so an alert can target a model, repo, or surface.

## Commands

`Weevil: Open Dashboard`, `Refresh`, `Spend Breakdown`, `Set Budget`, `Set
Status Bar Scope`, `Configure Notifications`, `Connect GitHub`, `Disconnect`,
`Export Data`, `Clear Data`, `Show Tips`.

## Development

```bash
npm ci
npm run compile        # build host + webview bundles
npm run check-types    # type-check both tsconfigs
npm run lint
npm run test:unit      # pure logic tests (mocha + ts-node)
npm test               # integration tests (real VS Code host)
```

Press **F5** to launch an Extension Development Host. The status bar chip
appears within ~1s on sample data; `Weevil: Open Dashboard` opens the full view.

## License

MIT © Jurrean De Nys
