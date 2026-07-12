# Settings Reference

Mallard reads only a few VS Code settings. Budget, included credits, alert
thresholds, display currency, and the dashboard layout are not settings; you edit
them in the dashboard and they are stored in `config.json` (see the Configuration
guide). The old `mallard.currency` setting was removed — set the currency from
the dashboard's header selector instead.

## Core settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `mallard.enabledConnectors` | `("copilot" \| "claude-code")[]` | both | Which connectors Mallard ingests from. Set automatically by the onboarding flow when both Copilot and Claude Code are installed. Changing it requires reloading the window — Mallard prompts for the reload when it changes. |
| `mallard.copilotLogPath` | `string` | `""` | Override the log directory. Blank means auto-detect via `vscode.env.logUri`. |
| `mallard.pricingManifestUrl` | `string` | `""` | Override the pricing manifest URL. Blank means use the built-in URL. |
| `mallard.palette` | `"swiss" \| "theme"` | `"swiss"` | Dashboard chart palette. `swiss` is the fixed duotone; `theme` derives the accent from your VS Code theme. Both keep the duotone structure and are checked for accessibility. |
| `mallard.refreshIntervalMinutes` | `number` | `10` | How often Mallard re-scans logs and rebuilds the snapshot. Range: 1–60 minutes. Lower values update the dashboard faster but increase CPU usage. |
| `mallard.dataRetentionDays` | `number` | `90` | How many days of raw events to keep before rolling up to daily rows. Range: 30–365. Older events are stored as daily aggregates; per-event detail is lost after this window. Applies at startup — Mallard prompts for a window reload when it changes. |
| `mallard.githubBilling.org` | `string` | `""` | GitHub organization slug for org-level Copilot billing in this workspace. Overrides the `githubBilling.org` value from `config.json`. Blank means personal billing. |

## Metric export settings

Mallard can stream a usage feature vector to a self-hosted server after every snapshot.
All export settings are machine-scoped (`"scope": "machine-overridable"`)
so credentials are not synced across machines by VS Code Settings Sync.

### Server and transport

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `mallard.server.url` | `string` | `""` | Base URL of your self-hosted Mallard server (e.g. `https://mallard.example.com`). Used as the webhook endpoint and as the fallback MQTT WebSocket host. |
| `mallard.export.transport` | `"" \| "webhook" \| "mqtt"` | `""` | Transport to use. Leave blank to disable. Set `mallard.server.url` first. Transport, auth, URL, and certificate changes apply immediately — the exporter is rebuilt in place. |

### Webhook auth

Active when `mallard.export.transport = "webhook"`. The credential itself is
stored in SecretStorage, never in settings — run **Mallard: Set Webhook API
Key** or **Mallard: Set Webhook Bearer Token** (or **Mallard: Manage
Credentials**) from the Command Palette.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `mallard.webhook.auth` | `"apiKey" \| "bearer" \| "certificate"` | `"apiKey"` | Auth method. |

### MQTT

Active when `mallard.export.transport = "mqtt"`. Only `wss://` URLs are accepted.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `mallard.mqtt.url` | `string` | `""` | MQTT broker WebSocket URL (e.g. `wss://mallard.example.com/mqtt`). Overrides `mallard.server.url` for MQTT. |
| `mallard.mqtt.auth` | `"password" \| "certificate"` | `"password"` | Auth method. |
| `mallard.mqtt.username` | `string` | `""` | MQTT username, sent in CONNECT as broker metadata. The server identifies you by the shared broker password and tags all MQTT data `source='mqtt'` — the username is **not** used for identification. |

Run **Mallard: Set MQTT Export Password** from the Command Palette to store the password securely in VS Code's SecretStorage (never written to settings files).

### Shared certificate (mTLS)

Used by any transport when `auth = certificate`.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `mallard.shared.certificate.file` | `string` | `""` | Path to PEM client certificate file. |
| `mallard.shared.certificate.keyFile` | `string` | `""` | Path to PEM private key file. |
| `mallard.shared.certificate.caFile` | `string` | `""` | Path to CA bundle PEM file to verify the server's TLS certificate. |

### Payload schema

Each publish sends a single JSON object, built by `buildMetricPayload` and published to the `mallard/v3/metrics` topic. The extension sends `schema_version: 3`. The Metrics Schema reference page has the full field table, aggregation semantics, and how the server handles a schema version it doesn't recognize yet.

### Webhook example (API key)

```json
"mallard.server.url": "https://your-server",
"mallard.export.transport": "webhook",
"mallard.webhook.auth": "apiKey"
```

Then run **Mallard: Set Webhook API Key** from the Command Palette to store the
key securely. (The key's *label* — which team/person it belongs to — is
configured server-side in the secret manager, not in the key value you enter.)

### Multiple webhook servers

The webhook transport can mirror every payload to additional servers (e.g. a
personal and a team endpoint). Declare them in `config.json`:

```json
"export": {
  "webhookTargets": [
    { "name": "team", "url": "https://mallard.team.example.com" }
  ]
}
```

Each target authenticates with its own credentials, namespaced by the target
name — set them via **Mallard: Manage Credentials**, where each target shows
up as its own API key / bearer token / signing secret slot. The auth method
(`mallard.webhook.auth`) and any mTLS certificate paths are shared across all
targets. A payload is queued for retry only while every failing target is
retryable; a target that rejects with a 4xx (bad credential) fails the batch
fatally so the queue can't spin forever.

The MQTT transport mirrors the same way with `"mqttTargets"` (each broker gets
its own CONNECT password slot in **Manage Credentials**; the username and any
certificate paths are shared):

```json
"export": {
  "mqttTargets": [
    { "name": "team-broker", "url": "wss://mallard.team.example.com/mqtt" }
  ]
}
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
