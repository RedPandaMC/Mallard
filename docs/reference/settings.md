# Settings Reference

Mallard reads only a few VS Code settings. Budget, included credits, and alert
thresholds are not settings; you edit them in the dashboard and they are stored per user.

## Core settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `mallard.currency` | `string` | `"USD"` | Display currency for all cost amounts (e.g. `EUR`, `GBP`, `JPY`). Exchange rates are fetched daily from Frankfurter. Exports always use USD. |
| `mallard.copilotLogPath` | `string` | `""` | Override the log directory. Blank means auto-detect via `vscode.env.logUri`. |
| `mallard.pricingManifestUrl` | `string` | `""` | Override the pricing manifest URL. Blank means use the built-in URL. |
| `mallard.palette` | `"swiss" \| "theme"` | `"swiss"` | Dashboard chart palette. `swiss` is the fixed duotone; `theme` derives the accent from your VS Code theme. Both keep the duotone structure and are checked for accessibility. |
| `mallard.refreshIntervalMinutes` | `number` | `10` | How often Mallard re-scans logs and rebuilds the snapshot. Range: 1–60 minutes. Lower values update the dashboard faster but increase CPU usage. |
| `mallard.dataRetentionDays` | `number` | `90` | How many days of raw events to keep before rolling up to daily rows. Range: 30–365. Older events are stored as daily aggregates; per-event detail is lost after this window. |

## Metric export settings

Mallard can stream a usage feature vector to a self-hosted server after every snapshot.
All export settings are machine-scoped (`"scope": "machine-overridable"`)
so credentials are not synced across machines by VS Code Settings Sync.

### Server and transport

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `mallard.server.url` | `string` | `""` | Base URL of your self-hosted Mallard server (e.g. `https://mallard.example.com`). Used as the webhook endpoint and as the fallback MQTT WebSocket host. |
| `mallard.export.transport` | `"" \| "webhook" \| "mqtt"` | `""` | Transport to use. Leave blank to disable. Set `mallard.server.url` first. |

### Webhook auth

Active when `mallard.export.transport = "webhook"`.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `mallard.webhook.auth` | `"apiKey" \| "bearer" \| "certificate"` | `"apiKey"` | Auth method. |
| `mallard.webhook.apiKey` | `string` | `""` | API key sent as `X-API-Key` header. Active when `auth = apiKey`. |
| `mallard.webhook.bearerToken` | `string` | `""` | Token sent as `Authorization: Bearer`. Active when `auth = bearer`. |

### MQTT

Active when `mallard.export.transport = "mqtt"`. Only `wss://` URLs are accepted.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `mallard.mqtt.url` | `string` | `""` | MQTT broker WebSocket URL (e.g. `wss://mallard.example.com/mqtt`). Overrides `mallard.server.url` for MQTT. |
| `mallard.mqtt.auth` | `"password" \| "certificate"` | `"password"` | Auth method. |
| `mallard.mqtt.username` | `string` | `""` | MQTT username. Active when `auth = password`. |

Run **Mallard: Set MQTT Export Password** from the Command Palette to store the password securely in VS Code's SecretStorage (never written to settings files).

### Shared certificate (mTLS)

Used by any transport when `auth = certificate`.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `mallard.shared.certificate.file` | `string` | `""` | Path to PEM client certificate file. |
| `mallard.shared.certificate.keyFile` | `string` | `""` | Path to PEM private key file. |
| `mallard.shared.certificate.caFile` | `string` | `""` | Path to CA bundle PEM file to verify the server's TLS certificate. |

### Payload schema

Each publish sends a single JSON object, built by `buildMetricPayload` and published to the `mallard/v2/metrics` topic:

| Field | Type | Description |
|-------|------|-------------|
| `schema_version` | `1` | Payload schema version. |
| `ts` | `string` | ISO 8601 timestamp of the snapshot. |
| `model_dist` | `Record<string, number>` | Fraction of credits attributable to each model (sums to ≤1). |
| `surface_dist` | `Record<string, number>` | Fraction of credits attributable to each surface (sums to ≤1). |
| `cost_dist` | `Record<string, number>` | Fraction of cost attributable to each cost category (sums to ≤1). |
| `input_cost_ratio` | `number` | Deprecated: input/(input+output) cost ratio only. Use `cost_dist['input']` instead. |
| `credits_velocity_per_hour` | `number` | Credits used today divided by hours elapsed since midnight. |
| `mtd_budget_pct` | `number` | Month-to-date credits used as a fraction of the monthly budget (0 when no budget is set). |
| `repo_count` | `number` | Number of distinct repositories observed (count only, no names). |
| `peak_usage_hour` | `number` | Most active hour of the current day (0–23). |
| `daily_credit_variance` | `number` | Standard deviation of daily credits over the last 7 days. |
| `model_count` | `number` | Number of distinct models seen in the snapshot window. |
| `surface_concentration` | `number` | Gini coefficient of surface distribution (0 = balanced, 1 = concentrated on one surface). |
| `estimated_event_ratio` | `number` | Fraction of events with estimated (vs. GitHub-billing-authoritative) cost. |
| `forecast_basis` | `"linear" \| "seasonal" \| "insufficient-data"` | Forecaster used for the month-end projection. |
| `budget_trend` | `-1 \| 0 \| 1` | Spend trajectory vs. last week: accelerating, flat, or decelerating. |
| `token_per_credit` | `number` | Total tokens divided by total credits. |
| `forecast_low` / `forecast_high` | `number` | Confidence bounds for month-end projected credits. |
| `source_connector` | `string` | Primary data source (`"copilot"`, `"claude-code"`, `"mixed"`, or `"none"`). |

> [!WARNING]
> This payload does not match the self-hosted server's `IngestPayload` schema (no `instance_id`, no `today_credits`/`mtd_credits`/etc., and `ts` is a string here vs. an int there). Sending it to a stock Mallard server currently fails validation. See [issue tracker](https://github.com/RedPandaMC/Mallard/issues) before relying on this in production.

### Webhook example (API key)

```json
"mallard.server.url": "https://your-server",
"mallard.export.transport": "webhook",
"mallard.webhook.auth": "apiKey",
"mallard.webhook.apiKey": "team-alpha:key-abc123"
```

### MQTT example (password)

```json
"mallard.server.url": "https://your-server",
"mallard.export.transport": "mqtt",
"mallard.mqtt.auth": "password",
"mallard.mqtt.username": "alice"
```

Then run **Mallard: Set MQTT Export Password** from the Command Palette.

### MQTT example (mTLS)

```json
"mallard.server.url": "https://your-server",
"mallard.export.transport": "mqtt",
"mallard.mqtt.auth": "certificate",
"mallard.shared.certificate.file": "/home/you/.certs/client.crt",
"mallard.shared.certificate.keyFile": "/home/you/.certs/client.key",
"mallard.shared.certificate.caFile": "/home/you/.certs/ca.crt"
```
