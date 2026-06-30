# Features

Mallard is a local-first Copilot spend tracker. No sign-in is needed for anything except GitHub billing reconciliation — all other features run entirely offline.

## Dashboard

Open from the activity bar icon or **Mallard: Open Dashboard**. The dashboard shows:

- **KPI cards** — today, month-to-date, projected month-end, and top model
- **Spend gauge** — credits used against your included allowance, with severity colouring at 80% and 100% of budget
- **30-day bar chart** — daily spend with a projected-pace line and previous-period comparison bars
- **Model breakdown** — top models by credits
- **Sankey flow chart** — credits from each model to each surface (chat, inline, agent, edit)
- **Cost-type chart** — input vs output token spend

A pop-out button opens the same view as a full editor tab.

## Layout

Click **Edit layout** to drag, resize, or hide panels. Your arrangement is saved automatically. **Reset layout** restores defaults.

## Budget and alerts

Set a monthly budget, included-credit allowance, daily threshold, and velocity alert from the dashboard or directly in `config.json` (click **Edit alert rules**):

```json
{
  "monthlyBudget": 20,
  "includedCredits": 300,
  "dailyCreditAlert": 50,
  "alerts": { "velocityEnabled": true, "velocityCreditsPerHour": 40 }
}
```

## Custom alert rules

Write precise conditions using a JSONLogic-inspired language. Rules can fire VS Code notifications on any combination of spend, velocity, model, surface, branch, or time-of-day signals:

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

## Rule groups

Group rules to toggle a whole set at once from the dashboard without deleting them:

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

## Copilot restriction

Add a `restrict` block to any rule to show a popup when the condition fires. No extensions are disabled — the popup creates friction.

```json
{
  "id": "budget-exhausted",
  "severity": "critical",
  "message": "Monthly budget exhausted.",
  "when": { ">=": [{ "var": "budget.percentOfBudget" }, 1] },
  "restrict": { "mode": "hard", "scope": "copilot", "graceMinutes": 10 }
}
```

`soft` shows a dismissable warning notification with Dismiss and Snooze options — no extensions are disabled. `hard` disables the Copilot extensions in `scope` (for `"copilot"`: `github.copilot` and `github.copilot-chat`) and shows a persistent error notification that re-fires on every snapshot refresh while the condition is true.

Run **Mallard: Simulate Restriction State** from the Command Palette for a dry run — it reports what would happen without disabling anything.

## Branch-aware tracking

Every event is tagged to the active git branch and repo. Set per-branch credit caps in `config.json`:

```json
{ "branchBudgets": { "feature/big-refactor": 500, "main": 200 } }
```

When a branch hits its cap, Mallard fires a critical notification (4-hour cooldown). Custom rules can reference `currentBranchCredits` and `branchBudgets.<branch>` in conditions.

## Per-repo filtering

When multiple repos are open, Mallard attributes usage to the active workspace. A dropdown in the dashboard filters all charts and KPIs to a single repo.

## GitHub billing reconciliation

Run **Mallard: Sign In to GitHub** to pull the authoritative charge from GitHub's billing API — spend across all your machines, not just the current one. Sign-in is optional; all other features work without it.

## Metric streaming

After each snapshot Mallard can publish a JSON usage vector to a self-hosted server via webhook or MQTT. Set `mallard.server.url` and `mallard.export.transport`.

## Export

**Mallard: Export Monthly Report** saves a standalone, printable HTML file. No external requests; prints to PDF from any browser.

**Mallard: Export Usage Data** exports the raw event log as CSV or JSON — one row per event with timestamp, model, surface, source, credits, cost, tokens, repo, and branch.

## Automatic pricing

Credit multipliers ship with the extension and refresh daily from a validated URL. The bundled copy is the fallback when the network is unavailable. Override with `mallard.pricingManifestUrl` for a custom plan.
