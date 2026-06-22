# Configuration

Mallard works out of the box. Most of what you might want to change lives in the
dashboard, not in `settings.json`.

## Budget and alerts

Budget and alert thresholds live in a small JSON config file that lives in
Mallard's storage directory on your machine:

```
~/.config/Code/User/globalStorage/jurreandenys.mallard/mallard/config.json
```

Click **"Edit alert rules"** in the dashboard to open it in VS Code's native
JSON editor. VS Code automatically associates the bundled JSON Schema with the
file, so you get inline validation, hover docs, and autocompletion as you type.

The basic budget and alert fields look like this:

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

| Field | Type | Meaning |
| --- | --- | --- |
| `monthlyBudget` | number | USD budget; 0 turns budget alerts off. |
| `includedCredits` | number | Plan's monthly premium requests; colours the gauge. |
| `dailyCreditAlert` | number | Daily credit threshold; 0 turns it off. |
| `alerts.velocityEnabled` | boolean | Whether the spending-velocity alert is active. |
| `alerts.velocityCreditsPerHour` | number | Credits-per-hour rate that triggers it. |

Values are validated on load; a missing or malformed field falls back to its
default rather than breaking. The file lives on the machine it was created on
and is not synced across machines.

## Custom alert rules

Beyond the built-in budget alerts you can author arbitrarily precise rules using
a small JSON condition language. Rules live in the same `config.json` under the
`rules` array.

### Minimal rule

```json
{
  "rules": [
    {
      "id": "daily-high",
      "severity": "warning",
      "message": "Daily credit usage is high: {{today.credits}} credits used today.",
      "when": { ">": [{ "var": "today.credits" }, 100] }
    }
  ]
}
```

### Rule fields

| Field | Required | Description |
| --- | --- | --- |
| `id` | yes | Unique identifier. Used for cooldown bookkeeping. |
| `severity` | yes | `"info"`, `"warning"`, or `"critical"`. |
| `message` | yes | Text shown in the notification. Supports <code v-pre>{{ field.path }}</code> templates. |
| `when` | yes | JSON condition that must be true for the rule to fire. |
| `active` | no | Optional gate — rule is skipped unless this condition is true. |
| `cooldown` | no | Minimum time between firings: `"30m"`, `"4h"`, `"1d"`, `"1w"`. Default `1h`. |
| `requiresAuth` | no | Skip the rule unless the user is signed in to GitHub. |
| `notify` | no | Show a VS Code notification popup when the rule fires. |
| `restrict` | no | Optional Copilot restriction to apply (see below). |

### JSON condition format

Conditions are plain JSON objects — no custom expression language. The format is
inspired by JSONLogic.

**Comparison operators** — all take a two-element array of operands:

```json
{ ">":  [{ "var": "today.credits" }, 100] }
{ ">=": [{ "var": "budget.percentOfBudget" }, 0.8] }
{ "<":  [{ "var": "velocity.creditsPerHour" }, 50] }
{ "<=": [{ "var": "now.hour" }, 17] }
{ "==": [{ "var": "now.weekday" }, 0] }
{ "!=": [{ "var": "currentBranch" }, "main"] }
```

**Boolean operators:**

```json
{ "and": [<condition>, <condition>, ...] }
{ "or":  [<condition>, <condition>, ...] }
{ "not": <condition> }
```

**Field reference operand** — resolves a dot-separated path into the live context:

```json
{ "var": "today.credits" }
```

**Literal operands** — numbers, strings, and booleans are used directly:

```json
{ ">": [{ "var": "today.credits" }, 50] }
```

**Literal condition** — `true` means "always fire", `false` means "never fire":

```json
{ "when": true }
```

### Compound example

Fire a warning when spending velocity is high *and* the budget is not already
exhausted, but suppress it on weekends:

```json
{
  "id": "velocity-warning",
  "severity": "warning",
  "message": "High velocity: {{velocity.creditsPerHour}} credits/hour.",
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
}
```

### Context field reference

These fields are available as `{ "var": "..." }` operands in every rule.

| Path | Type | Description |
| --- | --- | --- |
| `today.credits` | number | Credits used today. |
| `today.cost` | number | Cost (USD) used today. |
| `today.tokens` | number | Tokens consumed today. |
| `month.credits` | number | Credits used month-to-date. |
| `month.cost` | number | Cost (USD) used month-to-date. |
| `window7d.credits` | number | Credits used in the last 7 days. |
| `window7d.cost` | number | Cost (USD) in the last 7 days. |
| `budget.monthly` | number \| null | Monthly budget in USD, or null if unset. |
| `budget.includedCredits` | number | Plan's monthly premium request allowance. |
| `budget.usedCredits` | number | Credits used against the budget this month. |
| `budget.usedCost` | number | Cost (USD) against the budget this month. |
| `budget.percentOfBudget` | number | Month-to-date cost as a fraction of the monthly budget (0–1+). |
| `budget.percentOfIncluded` | number | Credits used as a fraction of the included allowance. |
| `budget.projectedOverage` | number \| null | Projected end-of-month overage in USD, or null. |
| `budget.pace` | string | `"on-track"`, `"at-risk"`, `"over"`, or `"no-budget"`. |
| `forecast.projectedCredits` | number | Projected month-end credits. |
| `forecast.projectedCost` | number | Projected month-end cost in USD. |
| `forecast.low` | number | Lower bound of the forecast. |
| `forecast.high` | number | Upper bound of the forecast. |
| `forecast.basis` | string | `"linear"` or `"insufficient-data"`. |
| `velocity.creditsPerHour` | number | Recent spending rate in credits/hour. |
| `velocity.windowMinutes` | number | How many minutes of history the velocity covers. |
| `topModel.id` | string \| null | Model key with the most credits today. |
| `topModel.credits` | number | Credits for the top model. |
| `topRepo.id` | string \| null | Repository with the most credits today. |
| `topRepo.credits` | number | Credits for the top repository. |
| `model.<key>.credits` | number | Credits for a specific model (e.g. `model.gpt-4o.credits`). |
| `surface.<key>.credits` | number | Credits for a specific surface (e.g. `surface.chat.credits`). |
| `repo.<key>.credits` | number | Credits for a specific repository. |
| `billing.netAmount` | number | GitHub billing net amount (requires sign-in). |
| `billing.quotaPercentRemaining` | number | Fraction of quota remaining (0–1). |
| `billing.unlimited` | boolean | Whether the plan has unlimited credits. |
| `now.weekday` | number | Day of week: 0 = Sunday, 6 = Saturday. |
| `now.hour` | number | Hour of day (0–23, local time). |
| `now.minute` | number | Minute of hour (0–59, local time). |
| `now.ts` | number | Current Unix timestamp in milliseconds. |
| `signedIn` | boolean | Whether the user is signed in to GitHub. |
| `currentBranch` | string \| null | Current git branch (if a workspace is open). |
| `currentBranchCredits` | number | Credits used in the current branch's sessions. |
| `vars.<name>` | any | User-defined variable (see `vars` block below). |
| `group.<id>` | boolean | Whether the named group is currently active. |

### Message templates

Rule messages support <code v-pre>{{ field.path }}</code> placeholders. They resolve the same
dot-path into the evaluation context and format numbers to two decimal places
(or as integers when the value is whole):

```json
"message": "{{today.credits}} credits used ({{budget.percentOfBudget | round}}% of budget)"
```

Only simple dot-paths are supported. There is no arithmetic inside <code v-pre>{{ }}</code>.

### User-defined variables

The `vars` block lets you name thresholds so they are easy to update in one
place:

```json
{
  "vars": { "alertThreshold": 80, "maxHourly": 40 },
  "rules": [
    {
      "id": "threshold",
      "severity": "warning",
      "message": "Over {{vars.alertThreshold}} credits today.",
      "when": { ">": [{ "var": "today.credits" }, { "var": "vars.alertThreshold" }] }
    }
  ]
}
```

### Rule groups

Group rules so you can enable or disable a whole set at once. Set a group's
`active` field to `false` to suppress all rules that reference it:

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

Set `"active": false` in the group object (or toggle it from the dashboard) to
silence the entire group without deleting the rules.

### Copilot restrictions

A `restrict` block lets a rule not only alert but also disable Copilot
extensions when the condition fires:

```json
{
  "id": "hard-stop",
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
| `mode` | `"soft"` \| `"hard"` | `soft` shows a warning banner. `hard` disables Copilot extensions. |
| `scope` | `"copilot"` \| `"copilot+lab"` \| `"custom"` | Which extensions are affected by a hard restriction. |
| `graceMinutes` | number (0–1440) | Minutes before a hard restriction takes effect. |
| `reEnableWhen` | condition | Automatically clears the restriction when this condition becomes true. |

## Arranging the dashboard

Click "Edit layout" above the charts to rearrange the analysis view. While
editing you can:

- Drag a panel by its handle to reorder it.
- Toggle a panel between half and full width to scale it.
- Hide a panel you do not use, or show it again.

Charts always scale to fit their panel. Your arrangement is saved automatically
and restored on the next launch, on every machine signed in to the same VS Code
profile. "Reset layout" restores the defaults.

## Removing your data

All of Mallard's data stays on your machine: usage events in the extension's
global storage, your budget, alert, and layout choices in VS Code's per-user
state, and a cached pricing manifest. VS Code does not delete this when you
uninstall an extension, so to remove everything run "Mallard: Clear All Data"
first, then uninstall.

## VS Code settings

Three settings cover cases where auto-detection does not fit. See the
[Settings reference](/reference/settings) for full descriptions.

| Setting | Default | Description |
| --- | --- | --- |
| `mallard.copilotLogPath` | `""` | Override the log directory (blank = auto-detect). |
| `mallard.pricingManifestUrl` | `""` | Override the pricing manifest URL (blank = built-in). |
| `mallard.palette` | `"swiss"` | Chart palette: `swiss` = fixed duotone; `theme` = VS Code theme colour. |
