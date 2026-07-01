# Metrics Schema Reference

The extension and the self-hosted server are versioned and upgraded independently. Every metric payload carries a `schema_version` so the server can tell which shape it's looking at, and the server is a tolerant reader: it accepts an older extension's payload, a newer one, and even a `schema_version` it has never seen before, rather than rejecting an export outright. This page documents both known versions and how the server handles the rest.

## Version history

| Version | Sent by | Notes |
| --- | --- | --- |
| `1` | Older extension builds | Rich per-snapshot analytics, but no stable instance identifier and `ts` is an ISO 8601 string. |
| `2` | Current extension | Adds `instance_id` and the absolute month-to-date/today totals the server needs for per-instance dashboards. `ts` is Unix epoch milliseconds. All of v1's analytics fields are still sent. |

## v2 fields (current)

| Field | Type | Description |
| --- | --- | --- |
| `schema_version` | `2` | Payload schema version. |
| `instance_id` | `string` | One-way SHA-256 hash of VS Code's machineId. Stable per install, not reversible to identify the machine or user. |
| `ts` | `number` | Unix epoch milliseconds of the snapshot. |
| `mtd_credits` | `number` | Month-to-date credits used. |
| `mtd_cost_usd` | `number` | Month-to-date cost in USD. |
| `today_credits` | `number` | Credits used today. |
| `today_cost_usd` | `number` | Cost today in USD. |
| `active_models` | `string[]` | All distinct model IDs seen in the current data (no other detail). |
| `top_model` | `string \| null` | The single most-used model by credits, or `null` if there's no data yet. |
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

## How the server ingests every version

Both the HTTP webhook and the MQTT transport funnel through the same normalization step before anything is written to InfluxDB, so the two transports behave identically:

1. The raw JSON body is read just enough to find `schema_version`.
2. A known version (`1` or `2`) is validated against its own shape and mapped into one canonical internal record. Fields a given version can't supply (for example, `mtd_cost_usd` on a v1 payload) are stored as absent, not zero.
3. A `schema_version` the server has never seen, or a known version whose payload doesn't actually match its expected shape, falls back to a best-effort mapping: every field name the server recognizes is coerced if possible, and anything left over is preserved in an internal `extra` field rather than discarded, so a future server version can make sense of it without the client needing to resend anything.
4. `connector` (from `source_connector`) becomes its own InfluxDB tag, so a single instance running multiple connectors, for example Copilot and Claude Code, can be split apart in Grafana.

The only thing that gets a request rejected outright is a body that isn't valid JSON, or one with no `schema_version` at all — there's no way to route those anywhere. Everything else is accepted, even in degraded form, which is what lets an extension and a server move at different release speeds: an old server still understands a new client's export, and a new server still fully understands an old client's.

`GET /health` reports `min_known_schema_version` and `max_known_schema_version` so operators can spot version skew across a fleet of extension installs at a glance.
