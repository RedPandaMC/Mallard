# Features

Mallard is a local-first spend tracker for GitHub Copilot and Claude Code. No sign-in is needed for anything except GitHub billing reconciliation; all other features run entirely offline.

## Data sources

Mallard reads whichever local usage logs are present: Copilot's OTel logs and Claude Code's JSONL session logs. Both are tracked automatically and simultaneously if both tools are installed and used; each event is tagged with its source connector, so the dashboard, alert rules, and exports can all break spend down by tool as well as by model, surface, and repo.

## Dashboard

Open from the activity bar icon or **Mallard: Open Dashboard**. The dashboard shows:

- **KPI cards**: today, month-to-date, projected month-end, and top model
- **Spend gauge**: credits used against your included allowance, with severity colouring at 80% and 100% of budget
- **30-day bar chart**: daily spend with a projected-pace line and previous-period comparison bars
- **Model breakdown**: top models by credits
- **Sankey flow chart**: credits from each model to each surface (chat, inline, agent, edit)
- **Cost-type chart**: input vs output token spend (plus cache and thinking categories for Claude Code sessions)

A pop-out button opens the same view as a full editor tab.

## Extra charts

Four more charts sit behind the **Add chart** button, hidden until you want them:

- **By repository** — spend per repo. Repos whose spend is partly attributed by the active-editor heuristic (see below) are marked with `≈`.
- **Cost categories over time** — a stacked view of input/output/cache/thinking/tool cost per day, showing how the mix shifts.
- **Tokens over time** — daily token volume, with request counts in the tooltip.
- **GitHub billing items** — net amount per model/SKU from the billing API (needs sign-in).

Added charts behave like the stock ones: drag, resize, hide, all persisted to `config.json`.

## Layout

Use **Resize** and **Move** to drag, resize, or hide panels. Your arrangement is saved automatically into `config.json`. **Reset layout** restores defaults.

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
    "message": "{{today.credits}} credits used today, slow down.",
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

## Restriction popups

Add a `restrict` block to any rule to show a popup when the condition fires. No extensions are disabled; the popup creates friction.

```json
{
  "id": "budget-exhausted",
  "severity": "critical",
  "message": "Monthly budget exhausted.",
  "when": { ">=": [{ "var": "budget.percentOfBudget" }, 1] },
  "restrict": {}
}
```

The popup shows Dismiss, Snooze 15m, Snooze 1h, and Disable Mallard... buttons. Disable Mallard... opens the Extensions view so you can turn Mallard off yourself; it is a manual step, never an automatic one.

Run **Mallard: Simulate Restriction State** from the Command Palette for a dry run. It reports what would happen without disabling anything.

## Branch-aware tracking

Every event is tagged to the active git branch and repo. Set per-branch credit caps in `config.json`:

```json
{ "branchBudgets": { "feature/big-refactor": 500, "main": 200 } }
```

When a branch hits its cap, Mallard fires a critical notification (4-hour cooldown). Custom rules can reference `currentBranchCredits` and `branchBudgets.<branch>` in conditions.

## Per-repo filtering and attribution

A dropdown in the dashboard filters all charts and KPIs to a single repo. How an event gets its repo depends on what the source log records:

| Attribution | Meaning |
|---|---|
| **Authoritative** | The log line itself names the workspace. Claude Code records the session's working directory per line, so its events are attributed reliably — even when old sessions are ingested later. |
| **Heuristic** (`≈`) | Copilot's logs carry no workspace path, so live events are attributed to the repo of the active editor at parse time — usually right, but a guess. Repos with heuristic spend are marked `≈` in the dropdown and the repository chart. |
| **Unattributed** | No trustworthy signal. Historical events found during a backfill (first install, or **Rebuild Ingested Data**) are never attributed by the heuristic — the usage happened before the current editor state existed, so guessing would silently blame the wrong repo. They land in the `unattributed` bucket instead. |

An event's attribution is fixed when it is first stored and never silently relabeled by a later re-read.

## GitHub billing reconciliation

Run **Mallard: Sign In to GitHub** to pull the authoritative Copilot charge from GitHub's billing API: spend across all your machines, not just the current one. Sign-in is optional; all other features work without it.

This is Copilot-specific and stays that way: GitHub exposes a user-scoped billing API an individual can authenticate against with their own account. Anthropic's usage/cost API is organization-admin-scoped, not something an individual Claude Code user can call the way they call GitHub's. Claude Code spend is always local-log-based (estimated), the same way Copilot spend is before you sign in.

## Metric streaming

After each snapshot Mallard can publish a JSON usage vector to a self-hosted server via webhook or MQTT. Set `mallard.server.url` and `mallard.export.transport`.

## Export

**Mallard: Export Monthly Report** saves a standalone, printable HTML file. No external requests; prints to PDF from any browser.

**Mallard: Export Usage Data** exports the raw event log as CSV or JSON, one row per event with timestamp, model, surface, source, credits, cost, tokens, repo, and branch.

## Automatic pricing

Credit multipliers ship with the extension and refresh daily from a validated URL. The bundled copy is the fallback when the network is unavailable. Override with `mallard.pricingManifestUrl` for a custom plan.
