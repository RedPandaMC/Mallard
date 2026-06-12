# Notifications

Weevil can alert you when your Copilot usage exceeds thresholds or burns at
unusual rates.

## How It Works

Each notification rule specifies:

1. **What to measure** — `metric` (cost, credits, tokens)
2. **When to alert** — Either a `threshold` (absolute value) or `velocity` (rate of change)
3. **Filter criteria** — Optional restrictions to specific models, repos, or surfaces

Rules are evaluated every refresh cycle (default: 15 minutes) and debounced so
you receive at most one toast per rule per cooldown window.

## Rule Schema

```typescript
interface NotificationRule {
  id: string; // Unique identifier
  type: 'threshold' | 'velocity';
  metric: 'cost' | 'credits' | 'tokens';

  // For threshold rules
  scope?: 'hour' | 'day' | 'week' | 'month';
  value: number;

  // For velocity rules
  window?: string; // e.g., "1h", "30m", "1d"
  value: number;

  // Optional filter
  filter?: {
    models?: string[]; // e.g., ["o3", "o4-mini"]
    repos?: string[]; // e.g., ["my-repo"]
    surfaces?: string[]; // e.g., ["sidebar", "chat"]
  };

  channel: 'toast' | 'status-only';
}
```

## Examples

### Daily Cost Threshold

Alert when daily spend exceeds $5:

```json
{
  "id": "daily-cost",
  "type": "threshold",
  "metric": "cost",
  "scope": "day",
  "value": 5,
  "channel": "toast"
}
```

### Hourly Burn Rate

Alert when using more than 50 credits per hour:

```json
{
  "id": "burn-rate",
  "type": "velocity",
  "metric": "credits",
  "window": "1h",
  "value": 50,
  "channel": "toast"
}
```

### Model-Specific Alert

Alert only when `o3` usage exceeds 100 credits in a week:

```json
{
  "id": "o3-weekly",
  "type": "threshold",
  "metric": "credits",
  "scope": "week",
  "value": 100,
  "filter": { "models": ["o3"] },
  "channel": "toast"
}
```

### Status-Only Alert

Track a metric without toasts (useful for dashboards):

```json
{
  "id": "monthly-total",
  "type": "threshold",
  "metric": "cost",
  "scope": "month",
  "value": 50,
  "channel": "status-only"
}
```

## Configuring Notifications

### Via Settings UI

1. Open the Command Palette
2. Run **Weevil: Configure Notifications**
3. This opens the `weevil.notifications` setting in VS Code Settings editor

### Via settings.json

```json
"weevil.notifications": [
  { "id": "daily-cost", "type": "threshold", "metric": "cost", "scope": "day", "value": 5, "channel": "toast" },
  { "id": "burn-rate",  "type": "velocity",  "metric": "credits", "window": "1h",  "value": 50, "channel": "toast" }
]
```

## Default Rules

Weevil ships with two default rules:

| Rule         | Condition                     |
| ------------ | ----------------------------- |
| `daily-cost` | Daily cost exceeds $5         |
| `burn-rate`  | More than 50 credits per hour |

These can be customized or disabled in `weevil.notifications`.

## Tips for Effective Alerts

1. **Start conservative** — Set higher thresholds initially, then lower them as
   you learn your typical usage patterns.

2. **Use velocity for real-time** — Velocity rules catch sudden spikes better
   than thresholds.

3. **Filter to relevant models** — If you only use expensive models
   occasionally, filter alerts to those models.

4. **Consider scope carefully** — Hourly scope catches rapid spending; monthly
   scope is better for budget tracking.
