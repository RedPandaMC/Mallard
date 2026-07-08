# Metrics Schema Reference

Mallard streams usage **events**, not aggregates: every batch of freshly ingested log entries is priced and labeled on-device, then published to your self-hosted server as finished records. The server stores one InfluxDB point per event; every aggregate (daily totals, month-to-date, per-model splits) is derived in Flux/Grafana, where it can be computed correctly for any group of instances and any time window.

There is exactly **one wire version: `1`**. Earlier state-snapshot payload drafts were retired before any public release. The server is still a tolerant reader — a payload carrying a *newer* `schema_version` is read best-effort with the same field names, and unknown per-event fields are preserved in an `extra_json` field rather than dropped — so an upgraded extension keeps working against an older server.

## The batch envelope

Each HTTP POST (or MQTT publish) carries one batch. Batches are chunked at 100 events, so even a first-install backfill of full history streams as a sequence of small payloads under the server's 64 KB body limit.

| Field | Type | Description |
| --- | --- | --- |
| `schema_version` | `1` | Streaming-protocol version. |
| `instance_id` | `string` | One-way SHA-256 hash of VS Code's machineId. Stable per install, not reversible. |
| `sent_at` | `number` | Unix epoch milliseconds when the batch was sent. |
| `tz_offset_minutes` | `number` | Client UTC offset in minutes at send time. |
| `events` | `StreamEvent[]` | The usage events (below). |

## StreamEvent

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Client event id (hashed file key + span/uuid fragment). Stable across re-sends — duplicates from delivery retries can be audited by it. |
| `ts` | `number` | Unix epoch milliseconds of the usage itself, not of the send. This becomes the InfluxDB point timestamp. |
| `connector` | `string` | Which connector produced the event (`local` = Copilot OTel, `claude-code`, …). |
| `model` | `string` | Model id. |
| `surface` | `string` | `chat`, `inline`, `agent`, `edit`, or `unknown`. |
| `credits` | `number` | Priced credit amount. |
| `cost_usd` | `number` | Priced USD cost. Always USD — display-currency conversion is client-side only. |
| `estimated` | `boolean` | True when the cost is log-derived (credit multiplier) rather than exact token pricing. |
| `prompt_tokens` … `thinking_tokens` | `number?` | Token counts; absent fields mean "not reported", never zero. |
| `cost_by_category` | `Record<string, number>?` | USD split per category (input, output, cache_read, cache_creation, thinking, tool). |
| `language` | `string?` | Detected programming language (VS Code languageId). Heuristic — the active editor at parse time, live events only — treat as directional. Absent events land under the `unknown` tag. |
| `repo` | `string?` | Repo the usage is attributed to (git slug or workspace folder name), calculated on the edge. Absent events land under the `unattributed` tag. |
| `branch` | `string?` | Git branch active at parse time (heuristic, live events only). |
| `attribution` | `string?` | How `repo` was determined: `authoritative` (recorded in the source log) or `heuristic` (active-editor guess). |

The division of labour: repo, branch, and language are **calculated on the edge** and shipped with each event; the server only aggregates them. Attribution to an API-key label, cert CN, or JWT claim exists **only on the server** (the `source` tag) — the client never knows or sends its own label. `instance_id` stays a one-way hash; no user identifiers cross the wire.

## Storage layout (InfluxDB)

One point per event in the `mallard_events` measurement, timestamped at the event's `ts`:

- **Tags** (indexed, bounded, sanitised): `source` (the server-side credential label — API key label, cert CN, or JWT claim), `connector`, `model`, `surface`, `language`, `repo`, `branch`, `attribution`, `instance_id`, `schema_version`.
- **Fields**: `credits`, `cost_usd`, `count` (always 1 — sum it for event counts), `estimated`, per-token-type counts, `cbc_<category>` cost splits, `event_id`, and `extra_json` for anything the server didn't recognize.

The server-side `source` tag and the edge-calculated labels compose: per-credential-per-repo, per-team-per-language, and similar splits are single Flux `group()` calls.

## Delivery semantics

- Batches are sent as ingest happens — a genuine streaming workload: bursty while you code, quiet when idle. On failure they are queued durably on-device (oldest-first, capped) and re-sent in order when the endpoint recovers.
- Delivery is at-least-once: a batch whose write succeeded but whose response was lost may be re-sent. Points with identical tags and millisecond timestamps overwrite rather than double-count; the `event_id` field makes remaining duplicates auditable.
- A batch is rejected (HTTP 400) only when it isn't a JSON object, has no integer `schema_version`, or has no `events` list. Everything else is read tolerantly.
