# Metrics Schema Reference

The extension and the self-hosted server are versioned and upgraded independently. Every metric payload carries a `schema_version` so the server can tell which shape it's looking at, and the server is a tolerant reader: it accepts the current version, a newer one, and even a `schema_version` it has never seen before, rather than rejecting an export outright. This page documents the current version and how the server handles the rest.

## Version history

| Version | Sent by | Notes |
| --- | --- | --- |
| `1` / `2` | Never shipped | Pre-release iterations; retired before any public release. A payload claiming these versions is still accepted via the best-effort path below. |
| `3` | Current extension | Additive counters + per-instance gauges. `ts` is Unix epoch milliseconds; `tz_offset_minutes` lets the server align client-local day boundaries. |

## Design principle

**Export additive counters and per-instance gauges; derive ratios server-side.**
Earlier drafts sent normalized fractions (`model_dist`), local-time statistics
(`peak_usage_hour`), and derived coefficients (Gini surface concentration).
None of those can be re-aggregated across instances — an average of ratios is
not the ratio of sums — so v3 sends the absolute inputs and leaves derivation
to Flux/Grafana, where it can be done correctly for any group of instances.

## v3 fields (current)

### Identity & time

| Field | Type | Description |
| --- | --- | --- |
| `schema_version` | `3` | Payload schema version. |
| `instance_id` | `string` | One-way SHA-256 hash of VS Code's machineId. Stable per install, not reversible to identify the machine or user. |
| `ts` | `number` | Unix epoch milliseconds of the snapshot. |
| `tz_offset_minutes` | `number` | Client UTC offset in minutes (e.g. `120` for CEST). All "today"/"month-to-date" windows are client-local. |

### Gauges — aggregate with `last()` per `instance_id`

| Field | Type | Description |
| --- | --- | --- |
| `mtd_credits` | `number` | Month-to-date credits used (client-local month). |
| `mtd_cost_usd` | `number` | Month-to-date cost in USD. |
| `today_credits` | `number` | Credits used today (client-local day). |
| `today_cost_usd` | `number` | Cost today in USD. |
| `mtd_budget_pct` | `number` | Month-to-date credits as a fraction of the monthly budget (0 when no budget is set). |
| `forecast_basis` | `"linear" \| "seasonal" \| "insufficient-data"` | Forecaster used for the month-end projection. |
| `forecast_low` / `forecast_high` | `number` | Confidence bounds for month-end projected credits. |
| `budget_trend` | `-1 \| 0 \| 1` | Spend trajectory vs. last week: accelerating, flat, or decelerating. |
| `daily_credit_stddev` | `number` | Standard deviation of daily credits over the last 7 days. |

### Counters — additive across instances

| Field | Type | Description |
| --- | --- | --- |
| `total_credits` | `number` | Credits in the snapshot window. |
| `total_tokens` | `number` | Total tokens (prompt + completion) in the snapshot window. |
| `total_event_count` | `number` | Events in the snapshot window. |
| `estimated_event_count` | `number` | Events whose cost is estimated (log-derived) rather than authoritative GitHub billing. Divide by `total_event_count` server-side for the estimated ratio. |
| `model_credits` | `Record<string, number>` | Absolute credits per model id. The server expands each entry into its own InfluxDB field (`model_credits_<id>`). |
| `surface_credits` | `Record<string, number>` | Absolute credits per surface (`surface_credits_<surface>` fields). |
| `cost_by_category` | `Record<string, number>` | Absolute USD cost per category — input, output, cache_creation, cache_read, thinking, tool (`cost_by_category_<cat>` fields). |

### Dimension metadata

| Field | Type | Description |
| --- | --- | --- |
| `active_models` | `string[]` | All distinct model IDs seen in the current data (stored as one comma-joined field plus `active_models_count`). |
| `top_model` | `string \| null` | The single most-used model by credits, or `null` if there's no data yet. |
| `model_count` | `number` | Number of distinct models seen in the snapshot window. |
| `repo_count` | `number` | Number of distinct repositories observed (count only, no names). |
| `source_connector` | `string` | Primary data source (`"local"`, `"claude-code"`, `"github"`, `"mixed"`, or `"none"`). Becomes the `connector` tag. |

## How the server ingests every version

Both the HTTP webhook and the MQTT transport funnel through the same normalization step before anything is written to InfluxDB, so the two transports behave identically:

1. The raw JSON body is read just enough to find `schema_version`.
2. A known version (`3`) is validated against its own shape and mapped into one canonical internal record. Fields the payload didn't supply are stored as absent, not zero.
3. A `schema_version` the server has never seen, or a known version whose payload doesn't actually match its expected shape, falls back to a best-effort mapping: every field name the server recognizes is coerced if possible, and anything left over is preserved in an internal `extra` field rather than discarded, so a future server version can make sense of it without the client needing to resend anything.
4. `connector` (from `source_connector`) becomes its own InfluxDB tag, so a single instance running multiple connectors, for example Copilot and Claude Code, can be split apart in Grafana.

The only thing that gets a request rejected outright is a body that isn't valid JSON, or one with no `schema_version` at all — there's no way to route those anywhere. Everything else is accepted, even in degraded form, which is what lets an extension and a server move at different release speeds.

`GET /health` reports `min_known_schema_version` and `max_known_schema_version` so operators can spot version skew across a fleet of extension installs at a glance.
