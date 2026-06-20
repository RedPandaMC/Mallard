# Settings Reference

Mallard reads only a few VS Code settings. Budget, included credits, and alert
thresholds are not settings; you edit them in the dashboard (see
[Configuration](/guide/configuration)) and they are stored per user.

## Core settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `mallard.copilotLogPath` | `string` | `""` | Override the log directory. Blank means auto-detect via `vscode.env.logUri`. |
| `mallard.pricingManifestUrl` | `string` | `""` | Override the pricing manifest URL. Blank means use the built-in URL. |
| `mallard.palette` | `"swiss" \| "theme"` | `"swiss"` | Dashboard chart palette. `swiss` is the fixed duotone; `theme` derives the accent from your VS Code theme. Both keep the duotone structure and are checked for accessibility. |

See [Configuration](/guide/configuration) for full descriptions and examples.

## Metric export settings (`mallard.metricExport.*`)

Mallard can stream a usage feature vector to an MQTT broker after every snapshot.
This is useful for storing time-series data in InfluxDB, Grafana, or a vector
database for anomaly detection and clustering. Only `mqtts://` (TLS) and
`wss://` (WebSocket TLS) broker URLs are accepted.

All `metricExport` settings are machine-scoped (`"scope": "machine-overridable"`)
so credentials are not synced across machines by VS Code Settings Sync.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `mallard.metricExport.brokerUrl` | `string` | `""` | MQTT broker URL. Only `mqtts://` and `wss://` (TLS) are accepted. Leave empty to disable. |
| `mallard.metricExport.topic` | `string` | `"mallard/metrics"` | MQTT topic prefix. A stable anonymous instance hash is appended automatically. |
| `mallard.metricExport.username` | `string` | `""` | MQTT username (optional). |
| `mallard.metricExport.password` | `string` | `""` | MQTT password (optional). Store in machine-scoped settings to avoid syncing credentials. |
| `mallard.metricExport.certPath` | `string` | `""` | Path to client certificate PEM file for mTLS. When set alongside `keyPath`, overrides username/password auth. |
| `mallard.metricExport.keyPath` | `string` | `""` | Path to client private key PEM file for mTLS. |
| `mallard.metricExport.caPath` | `string` | `""` | Path to broker CA certificate PEM file. Pins the broker CA to prevent MITM attacks. |

### Payload schema

Each publish sends a single JSON object with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `ts` | `string` | ISO 8601 timestamp of the snapshot. |
| `model_dist` | `Record<string, number>` | Fraction of credits per model (values sum to ≤ 1). |
| `surface_dist` | `Record<string, number>` | Fraction of credits per surface (values sum to ≤ 1). |
| `input_cost_ratio` | `number` | Fraction of cost attributable to input tokens (0–1; 0 when data unavailable). |
| `credits_velocity_per_hour` | `number` | Today's credits divided by hours elapsed since midnight. |
| `mtd_budget_pct` | `number` | Month-to-date cost as a fraction of the monthly budget (0 when no budget is set). |
| `repo_count` | `number` | Number of distinct repositories observed in the snapshot window. |

Example payload:

```json
{
  "ts": "2025-06-15T14:32:01.000Z",
  "model_dist": {
    "gpt-4o": 0.62,
    "claude-sonnet-4-5": 0.38
  },
  "surface_dist": {
    "chat": 0.71,
    "inline": 0.29
  },
  "input_cost_ratio": 0.43,
  "credits_velocity_per_hour": 18.4,
  "mtd_budget_pct": 0.34,
  "repo_count": 3
}
```

### Connection examples

**Local Mosquitto (TLS):**

```json
"mallard.metricExport.brokerUrl": "mqtts://localhost:8883"
```

Generate a self-signed CA and server cert with `openssl`, configure Mosquitto
with `cafile`, `certfile`, and `keyfile`, then point Mallard at your CA:

```json
"mallard.metricExport.caPath": "/etc/mosquitto/certs/ca.crt"
```

**HiveMQ Cloud (username/password):**

```json
"mallard.metricExport.brokerUrl": "mqtts://your-cluster.s1.eu.hivemq.cloud:8883",
"mallard.metricExport.username": "your-username",
"mallard.metricExport.password": "your-password"
```

**EMQX with mTLS:**

Generate client cert and key, then:

```json
"mallard.metricExport.brokerUrl":  "mqtts://emqx.example.com:8883",
"mallard.metricExport.certPath":   "/home/you/.certs/client.crt",
"mallard.metricExport.keyPath":    "/home/you/.certs/client.key",
"mallard.metricExport.caPath":     "/home/you/.certs/ca.crt"
```

When `certPath` and `keyPath` are both set, Mallard uses mTLS and ignores any
`username` / `password` values.
