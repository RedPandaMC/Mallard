# Configuration

Weevil offers extensive configuration via VS Code settings or `settings.json`.

## Core Settings

### `weevil.dataSource`

Where Weevil gets usage data from.

| Value    | Description                                                      |
| -------- | ---------------------------------------------------------------- |
| `auto`   | Use local Copilot logs if found, otherwise sample data (default) |
| `sample` | Always use generated sample data (for demos)                     |
| `local`  | Only use parsed local Copilot logs (no sample fallback)          |

### `weevil.monthlyBudget`

Monthly Copilot budget in your currency. Set to `0` to disable budget tracking.

```json
"weevil.monthlyBudget": 20
```

### `weevil.currency`

Currency code used to display costs. Any valid ISO 4217 code.

```json
"weevil.currency": "USD"
```

### `weevil.pricePerCredit`

Cost of one premium request credit, in your currency. The default ($0.04) matches
GitHub's standard rate for Copilot Pro.

```json
"weevil.pricePerCredit": 0.04
```

### `weevil.includedCredits`

Monthly included premium requests for your Copilot plan. Weevil subtracts this
from your total when calculating billable usage.

| Plan               | Included Credits |
| ------------------ | ---------------- |
| Copilot Pro        | 300              |
| Copilot Business   | 300              |
| Copilot Enterprise | Unlimited        |

```json
"weevil.includedCredits": 300
```

## Pricing Overrides

### `weevil.tokenPricing`

Per-model credit multiplier overrides. Useful if you use models with different
pricing than the default.

```json
"weevil.tokenPricing": {
  "o3": { "creditMultiplier": 2.0 },
  "o4-mini": { "creditMultiplier": 0.5 }
}
```

## Data Collection

### `weevil.copilotLogPath`

Override path to Copilot debug/OTel logs. Leave blank for auto-detection.

```json
"weevil.copilotLogPath": "/path/to/logs"
```

### `weevil.refreshIntervalMinutes`

How often Weevil re-reads usage data, in minutes.

```json
"weevil.refreshIntervalMinutes": 15
```

## Status Bar

### `weevil.statusBar.metric`

Which metric the status bar indicator shows.

| Value     | Description             |
| --------- | ----------------------- |
| `cost`    | Dollar amount (default) |
| `credits` | Premium request credits |
| `tokens`  | Total token count       |

### `weevil.statusBar.scope`

Which scope the status bar indicator reflects.

| Value       | Description             |
| ----------- | ----------------------- |
| `session`   | Current VS Code session |
| `today`     | Today (default)         |
| `workspace` | Current workspace       |
| `repo`      | Current Git repository  |

## Dashboard

### `weevil.pet.enabled`

Show the Weevil mascot (a friendly weevil) in the dashboard header.

```json
"weevil.pet.enabled": true
```

## Notifications

See the [Notifications documentation](./notifications.md) for the full alert
rule schema.

```json
"weevil.notifications": [
  {
    "id": "daily-cost",
    "type": "threshold",
    "metric": "cost",
    "scope": "day",
    "value": 5,
    "channel": "toast"
  }
]
```
