# Features

Mallard is a local-first Copilot spend tracker for VS Code. All of the features below work without a sign-in and make no network calls — your usage data never leaves your machine.

---

## Dashboard

Open the Mallard panel from the activity bar icon, or run **Mallard: Open Dashboard** from the Command Palette. The dashboard contains:

- **KPI cards** — today's credits and cost, month-to-date totals, a projected month-end figure, and the top model by spend.
- **Spend gauge** — a radial indicator comparing month-to-date cost against your budget.
- **30-day bar chart** — daily spend with a projected-pace trend line.
- **Model breakdown** — credits, cost, and token counts per model.
- **Surface flow** (Sankey) — how credits move between models and surfaces (chat, inline, agent, edit).
- **Spend by cost type** — input vs. output token cost.

A pop-out button in the toolbar opens the same view as a full editor tab.

---

## Arrangeable Analysis View

Click **Edit layout** above the charts to enter edit mode. While editing you can:

- **Drag** a panel by its handle to reorder it.
- **Resize** a panel between half and full width.
- **Hide** panels you don't use, or show them again.

Your arrangement is saved automatically and restored on the next launch. Use **Reset layout** to return to the defaults.

---

## Budget & Alerts

Set a monthly budget, an included-credit allowance, a daily credit threshold, and a spending-velocity alert from the dashboard or directly in `config.json` (click **Edit alert rules** to open the file). Changes apply live — no restart needed.

```json
{
  "monthlyBudget": 20,
  "includedCredits": 300,
  "dailyCreditAlert": 50,
  "alerts": {
    "velocityEnabled": true,
    "velocityCreditsPerHour": 40
  }
}
```

| Field | Description |
| --- | --- |
| `monthlyBudget` | USD budget for the month. `0` disables budget alerts. |
| `includedCredits` | Your plan's monthly premium-request allowance (colours the gauge). |
| `dailyCreditAlert` | Fire a warning when today's credits exceed this value. `0` disables it. |
| `alerts.velocityEnabled` | Enable the spending-velocity alert. |
| `alerts.velocityCreditsPerHour` | Credits per hour rate that triggers the velocity alert. |

---

## Custom Alert Rules

Write arbitrarily precise rules in `config.json` using a JSONLogic-inspired condition language. Rules fire VS Code notifications and optionally restrict Copilot.

```json
{
  "rules": [
    {
      "id": "daily-high",
      "severity": "warning",
      "message": "{{today.credits}} credits used today — slow down.",
      "when": { ">": [{ "var": "today.credits" }, 100] },
      "cooldown": "2h"
    }
  ]
}
```

### Condition operators

| Operator | Example |
| --- | --- |
| `>` `>=` `<` `<=` `==` `!=` | `{ ">": [{ "var": "today.credits" }, 100] }` |
| `and` | `{ "and": [condition, condition, ...] }` |
| `or` | `{ "or": [condition, condition, ...] }` |
| `not` | `{ "not": condition }` |
| `var` | `{ "var": "today.credits" }` — resolves a dot-path into the live context |
| literal | `true` (always fire) · `false` (never fire) |

### Rule fields

| Field | Required | Description |
| --- | --- | --- |
| `id` | yes | Unique identifier used for cooldown bookkeeping. |
| `severity` | yes | `"info"` · `"warning"` · `"critical"` |
| `message` | yes | Notification text. Supports <code v-pre>{{ field.path }}</code> placeholders. |
| `when` | yes | Condition that must be true for the rule to fire. |
| `active` | no | Gate condition — rule is skipped unless this is true. |
| `cooldown` | no | Minimum time between firings: `"30m"`, `"4h"`, `"1d"`. Default `1h`. |
| `notify` | no | Show a VS Code notification popup when the rule fires. |
| `restrict` | no | Optional Copilot restriction block. |

VS Code validates `config.json` automatically via the bundled JSON Schema, giving you inline autocompletion and hover docs as you type.

---

## Copilot Restriction

A `restrict` block on any rule can soft-warn or hard-disable Copilot extensions when the condition fires — for example, when the monthly budget is exhausted.

```json
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
```

| Field | Values | Description |
| --- | --- | --- |
| `mode` | `"soft"` · `"hard"` | `soft` shows a warning banner; `hard` disables the extension. |
| `scope` | `"copilot"` · `"copilot+lab"` · `"custom"` | Which extensions are affected. |
| `graceMinutes` | 0–1440 | Minutes before a hard restriction takes effect. |
| `reEnableWhen` | condition | Automatically lifts the restriction when this condition becomes true. |

Run **Mallard: Simulate Restriction** from the Command Palette for a dry run that shows which rules would fire without actually disabling anything.

---

## Rule Groups

Group related rules so you can enable or disable an entire set at once from the dashboard — without deleting the rules.

```json
{
  "groups": [
    { "id": "work-hours", "label": "Work-hour rules", "active": true }
  ],
  "rules": [
    {
      "id": "velocity",
      "severity": "warning",
      "message": "High velocity during work hours.",
      "when": { ">": [{ "var": "velocity.creditsPerHour" }, 40] },
      "active": { "var": "group.work-hours" }
    }
  ]
}
```

Toggle a group's `active` flag from the dashboard to silence all of its rules instantly.

---

## Spend by Model

Every AI call is attributed to its model. The dashboard shows a per-model breakdown of credits, cost, and token counts, both for today and for the selected time window. The top model by spend appears in the KPI cards at a glance.

---

## Spend by Surface

Usage is attributed to one of four surfaces: **chat**, **inline**, **agent**, or **edit**. The Sankey flow chart shows how credits flow from each model to each surface, so you can see exactly where your spend comes from.

---

## Branch-Aware Credit Tracking

Usage is tagged to the active git branch when a workspace is open. Per-branch totals appear in the dashboard's repo filter. Set per-branch credit caps in `config.json` and Mallard warns when a branch crosses its threshold:

```json
{
  "branchBudgets": {
    "feature/big-refactor": 500,
    "main": 200
  }
}
```

---

## Per-Repo Filtering

When several repositories are open in VS Code, Mallard attributes usage to the active workspace repo. A dropdown in the dashboard lets you filter all charts and KPI cards to a single repo, so you can compare spend across projects.

---

## Metric Streaming (MQTT)

After each snapshot Mallard can publish a JSON usage-vector to an MQTT broker over TLS (`mqtts://`) or WebSocket TLS (`wss://`). Plain-text connections are rejected.

The payload includes:

| Field | Description |
| --- | --- |
| `modelDist` | Per-model credit share (0–1) |
| `surfaceDist` | Per-surface credit share (0–1) |
| `creditsPerHour` | Current spending velocity |
| `mtdBudgetFraction` | Month-to-date cost as a fraction of budget |
| `todayCredits` | Credits used today |
| `mtdCredits` | Credits used month-to-date |
| `projectedCredits` | Projected month-end credit total |

Configure broker connection in VS Code settings under `mallard.metricExport.*`. mTLS is supported via `certPath`, `keyPath`, and `caPath`. See the [Settings reference](/reference/settings) for full details and broker examples (Mosquitto, HiveMQ Cloud, EMQX).

---

## GitHub Billing Reconciliation

Connect with VS Code's built-in GitHub session to pull the authoritative charge from GitHub's billing API. This aggregates usage across every machine you use, not just the current one.

Run **Mallard: Sign In to GitHub** from the Command Palette to connect. Once signed in, the dashboard shows a reconciled billing card alongside the local estimate. Sign-in is entirely optional — all other features work without it.

---

## Exportable Report

Run **Mallard: Export Monthly Report** to save a standalone, printable HTML report of the current snapshot. The report contains no external requests, so it prints to PDF cleanly from any browser.

---

## Automatic Pricing

Credit-to-cost multipliers ship with the extension and refresh once a day from a known URL, validated before use. The bundled copy is the fallback when the network is unavailable. A pricing change from GitHub is a one-line manifest update — no user action needed.

Override the manifest URL via `mallard.pricingManifestUrl` if you host a custom manifest for a non-standard plan.
