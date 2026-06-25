# Configuration

Mallard works out of the box. Budget and alert settings live in a JSON config file in Mallard's storage directory:

```
~/.config/Code/User/globalStorage/jurreandenys.mallard/mallard/config.json
```

Click **Edit alert rules** in the dashboard to open it with inline validation, hover docs, and autocompletion.

## Budget and alerts

```json
{
  "monthlyBudget": 20,
  "includedCredits": 300,
  "dailyCreditAlert": 50,
  "alerts": { "velocityEnabled": true, "velocityCreditsPerHour": 40 }
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `monthlyBudget` | 0 | USD budget; 0 disables budget alerts. |
| `includedCredits` | 0 | Plan's monthly premium-request allowance; colours the gauge. |
| `dailyCreditAlert` | 0 | Daily credit threshold; 0 disables it. |
| `alerts.velocityEnabled` | false | Enable the spending-velocity alert. |
| `alerts.velocityCreditsPerHour` | 40 | Credits/hour rate that triggers it. |

## Custom alert rules {#custom-alert-rules}

Rules live in the `rules` array. Each rule fires a VS Code notification and optionally restricts Copilot.

```json
{
  "rules": [{
    "id": "velocity-warning",
    "severity": "warning",
    "message": "High velocity ({{velocity.creditsPerHour}} cr/h) — not on weekends.",
    "when": {
      "and": [
        { ">":  [{ "var": "velocity.creditsPerHour" }, 40] },
        { "<":  [{ "var": "budget.percentOfBudget" }, 1] }
      ]
    },
    "active": {
      "and": [
        { "!=": [{ "var": "now.weekday" }, 0] },
        { "!=": [{ "var": "now.weekday" }, 6] }
      ]
    },
    "cooldown": "2h"
  }]
}
```

### Rule fields

| Field | Required | Description |
| --- | --- | --- |
| `id` | yes | Unique identifier; used for cooldown bookkeeping. |
| `severity` | yes | `"info"`, `"warning"`, or `"critical"`. |
| `message` | yes | Notification text. Supports <code v-pre>{{ field.path }}</code> placeholders. |
| `when` | yes | Condition that must be true for the rule to fire. |
| `active` | no | Gate — rule is skipped unless this condition is true. |
| `cooldown` | no | Min time between firings: `"30m"`, `"4h"`, `"1d"`. Default `1h`. |
| `notify` | no | Show a VS Code notification popup. |
| `restrict` | no | Copilot restriction block (see below). |

### Condition operators

| Operator | Form |
| --- | --- |
| `>` `>=` `<` `<=` `==` `!=` | `{ ">": [{ "var": "today.credits" }, 100] }` |
| `and` / `or` / `not` | `{ "and": [cond, cond] }` · `{ "not": cond }` |
| `var` | `{ "var": "today.credits" }` — dot-path into the live context |
| literal | `true` (always fire) · `false` (never fire) |

### Context fields

| Path | Type | Description |
| --- | --- | --- |
| `today.credits` / `today.cost` / `today.tokens` | number | Usage today. |
| `month.credits` / `month.cost` | number | Month-to-date totals. |
| `window7d.credits` / `window7d.cost` | number | Last 7 days. |
| `budget.monthly` | number \| null | Monthly budget in USD. |
| `budget.usedCredits` / `budget.usedCost` | number | Credits / cost used this month. |
| `budget.percentOfBudget` | number | MTD cost as fraction of budget (0–1+). |
| `budget.percentOfIncluded` | number | Credits as fraction of included allowance. |
| `budget.projectedOverage` | number \| null | Projected overage in USD. |
| `budget.pace` | string | `"on-track"`, `"at-risk"`, `"over"`, or `"no-budget"`. |
| `forecast.projectedCredits` / `forecast.projectedCost` | number | Month-end projection. |
| `forecast.low` / `forecast.high` | number | Projection confidence bounds. |
| `velocity.creditsPerHour` | number | Recent spending rate. |
| `topModel.id` / `topModel.credits` | string \| null, number | Top model today. |
| `topRepo.id` / `topRepo.credits` | string \| null, number | Top repo today. |
| `model.<key>.credits` | number | Credits for a specific model, e.g. `model.gpt-4o.credits`. |
| `surface.<key>.credits` | number | Credits for a specific surface, e.g. `surface.chat.credits`. |
| `billing.netAmount` / `billing.quotaPercentRemaining` | number | GitHub billing (requires sign-in). |
| `now.weekday` / `now.hour` / `now.minute` / `now.ts` | number | Current time values. |
| `signedIn` | boolean | Whether signed in to GitHub. |
| `currentBranch` / `currentBranchCredits` | string \| null, number | Active branch. |
| `vars.<name>` | any | User-defined variable (see `vars` block). |
| `group.<id>` | boolean | Whether the named group is active. |

### User-defined variables

```json
{
  "vars": { "alertThreshold": 80 },
  "rules": [{
    "id": "threshold",
    "severity": "warning",
    "message": "Over {{vars.alertThreshold}} credits today.",
    "when": { ">": [{ "var": "today.credits" }, { "var": "vars.alertThreshold" }] }
  }]
}
```

### Rule groups

Group rules so you can toggle a whole set at once:

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

### Copilot restrictions

```json
{
  "id": "hard-stop",
  "severity": "critical",
  "message": "Budget exhausted — Copilot disabled.",
  "when": { ">=": [{ "var": "budget.percentOfBudget" }, 1] },
  "restrict": { "mode": "hard", "scope": "copilot", "graceMinutes": 10,
    "reEnableWhen": { "<": [{ "var": "budget.percentOfBudget" }, 0.9] } }
}
```

| Field | Values | Description |
| --- | --- | --- |
| `mode` | `"soft"` \| `"hard"` | `soft` shows a warning banner; `hard` disables Copilot. |
| `scope` | `"copilot"` \| `"copilot+lab"` \| `"custom"` | Which extensions are affected. |
| `graceMinutes` | 0–1440 | Minutes before a hard restriction takes effect. |
| `reEnableWhen` | condition | Lifts the restriction automatically when this is true. |

## Dashboard layout

Click **Edit layout** to drag, resize, or hide panels. Your layout is saved and restored on next launch. **Reset layout** restores defaults.

## Removing your data

Run **Mallard: Clear All Data** before uninstalling to remove the DuckDB event store. VS Code does not delete extension storage on uninstall.

## VS Code settings

| Setting | Default | Description |
| --- | --- | --- |
| `mallard.copilotLogPath` | `""` | Override the log directory (blank = auto-detect). |
| `mallard.pricingManifestUrl` | `""` | Override the pricing manifest URL. |
| `mallard.palette` | `"swiss"` | `swiss` = fixed duotone; `theme` = VS Code theme colour. |
