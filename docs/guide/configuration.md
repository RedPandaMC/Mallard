# Configuration

Mallard works out of the box. Budget and alert settings live in a JSON config file in Mallard's storage directory:

```
~/.config/Code/User/globalStorage/RedPandaMC.mallard/mallard/config.json
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
| `includedCredits` | 300 | Plan's monthly premium-request allowance; colours the gauge. |
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
    "message": "High velocity ({{velocity.creditsPerHour}} cr/h), not on weekends.",
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

The most-used context fields are
`today.credits`, `budget.percentOfBudget`, `budget.pace`, and `velocity.creditsPerHour`.

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

### Restriction popups

A rule with a `restrict` block shows a popup when it fires, instead of (or alongside) a plain notification.

```json
{
  "id": "budget-exhausted",
  "severity": "critical",
  "message": "Budget exhausted.",
  "when": { ">=": [{ "var": "budget.percentOfBudget" }, 1] },
  "restrict": {}
}
```

The popup offers **Dismiss**, **Snooze 15m**, **Snooze 1h**, and **Disable Mallard...**. Mallard never disables any extension automatically; **Disable Mallard...** opens the Extensions view filtered to Mallard so you can turn it off yourself in one click. Snoozing sets a temporary override; the popup won't reappear until the override expires.

Set `"restrict": { "reEnableWhen": <condition> }` to have the popup clear itself automatically once that condition becomes true (for example, once spend drops back under budget), instead of waiting for the next snooze to expire.

## Dashboard layout

Use the **Resize** and **Move** buttons to drag, resize, or hide panels, and **Add chart** to bring in the optional extra charts (by repository, cost categories over time, tokens over time, GitHub billing items). Every change is saved straight into `config.json`'s `dashboard.panels` block — the same file as your budget and rules — so the layout is hand-editable and travels with the file. **Reset layout** restores defaults.

## Display currency

The currency selector in the dashboard header writes `currency` into `config.json` (e.g. `"currency": "EUR"`). Exchange rates are fetched daily from Frankfurter; metric exports always use USD regardless.
