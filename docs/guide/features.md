# Features

Mallard is a local-first Copilot spend tracker. All features below work without a sign-in and make no network calls — your usage data never leaves your machine.

---

## Dashboard

Open from the activity bar icon or **Mallard: Open Dashboard**. The dashboard contains KPI cards (today, month-to-date, projected, top model), a spend gauge, a 30-day bar chart, per-model breakdown, surface flow (Sankey), and spend by cost type. A pop-out button opens the same view as a full editor tab.

---

## Arrangeable Analysis View

Click **Edit layout** to reorder, resize, or hide panels. Your arrangement is saved automatically. Use **Reset layout** to return to defaults.

---

## Budget & Alerts

Set a monthly budget, included-credit allowance, daily credit threshold, and velocity alert from the dashboard or directly in `config.json` (click **Edit alert rules**):

```json
{
  "monthlyBudget": 20,
  "includedCredits": 300,
  "dailyCreditAlert": 50,
  "alerts": { "velocityEnabled": true, "velocityCreditsPerHour": 40 }
}
```

| Field | Description |
| --- | --- |
| `monthlyBudget` | USD budget for the month. `0` disables budget alerts. |
| `includedCredits` | Monthly premium-request allowance (colours the gauge). |
| `dailyCreditAlert` | Daily credit threshold. `0` disables it. |
| `alerts.velocityEnabled` | Enable the spending-velocity alert. |
| `alerts.velocityCreditsPerHour` | Credits/hour rate that triggers the alert. |

---

## Custom Alert Rules

Write precise rules in `config.json` using a JSONLogic-inspired condition language. See [Configuration](/guide/configuration#custom-alert-rules) for the full rule syntax and context field reference.

```json
{
  "rules": [{
    "id": "daily-high",
    "severity": "warning",
    "message": "{{today.credits}} credits used today — slow down.",
    "when": { ">": [{ "var": "today.credits" }, 100] },
    "cooldown": "2h"
  }]
}
```

---

## Copilot Restriction

A `restrict` block on any rule can soft-warn or hard-disable Copilot when the condition fires:

```json
{
  "id": "budget-exhausted",
  "severity": "critical",
  "message": "Monthly budget exhausted — Copilot disabled.",
  "when": { ">=": [{ "var": "budget.percentOfBudget" }, 1] },
  "restrict": { "mode": "hard", "scope": "copilot", "graceMinutes": 10 }
}
```

Run **Mallard: Simulate Restriction** for a dry run without actually disabling anything.

---

## Rule Groups

Group rules so you can toggle a whole set at once from the dashboard without deleting them:

```json
{
  "groups": [{ "id": "work-hours", "label": "Work-hour rules", "active": true }],
  "rules": [{
    "id": "velocity",
    "severity": "warning",
    "message": "High velocity during work hours.",
    "when": { ">": [{ "var": "velocity.creditsPerHour" }, 40] },
    "active": { "var": "group.work-hours" }
  }]
}
```

---

## Spend by Model & Surface

Every call is attributed to its model and surface (chat, inline, agent, edit). The dashboard's per-model breakdown and Sankey flow chart show exactly where credits come from.

---

## Branch-Aware Credit Tracking

Usage is tagged to the active git branch. Set per-branch caps (in credits) in `config.json`:

```json
{ "branchBudgets": { "feature/big-refactor": 500, "main": 200 } }
```

When credits consumed on a branch reach its cap, Mallard fires a critical notification: _"Branch 'main' has used 200 cr of its 200 cr cap."_ The notification respects a 4-hour cooldown so it won't repeat every refresh cycle.

You can also reference branch caps in custom alert rules via the JSONLogic context:

```json
{
  "id": "branch-budget-warning",
  "severity": "warning",
  "message": "Branch {{currentBranch}} approaching its cap ({{currentBranchCredits}} cr used).",
  "when": { ">=": [{ "var": "currentBranchCredits" }, { "var": "branchBudgets.main" }] }
}
```

---

## Per-Repo Filtering

When multiple repos are open, Mallard attributes usage to the active workspace. A dropdown filters all charts and KPIs to a single repo.

---

## Metric Streaming

After each snapshot Mallard can publish a JSON usage-vector to a self-hosted server via webhook or MQTT. Set `mallard.server.url` and `mallard.export.transport` — see the [Settings reference](/reference/settings) for payload schema, transport options, and mTLS.

---

## GitHub Billing Reconciliation {#github-billing-reconciliation}

Connect via **Mallard: Sign In to GitHub** to pull the authoritative charge from GitHub's billing API. Once signed in, the dashboard shows the reconciled total alongside the local estimate. Sign-in is optional — all other features work without it.

---

## Exportable Report

Run **Mallard: Export Monthly Report** to save a standalone, printable HTML report. No external requests — prints to PDF cleanly from any browser.

---

## Automatic Pricing

Credit multipliers ship with the extension and refresh daily from a validated URL. The bundled copy is the fallback when the network is unavailable. Override via `mallard.pricingManifestUrl` for a custom plan.
