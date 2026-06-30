# Identity Tagging

Every data point written to InfluxDB carries a `source` tag that identifies who sent it. This enables per-team dashboards, quota enforcement, and audit trails without a separate identity layer.

## Credential format

Use `label:secret` pairs when configuring credentials:

```bash
# .env or secret manager
API_KEYS=team-alpha:key-abc123,team-beta:key-def456
MQTT_CREDENTIALS=alice:mqtt-pass1,ci-pipeline:mqtt-pass2
```

The label (before the colon) becomes the `source` tag. Bare values (no colon) get the label `unknown`.

## Source tag precedence (HTTP)

1. **mTLS certificate CN** — if the client presents a cert issued by `mallard-ca`, the Common Name is used as `source`. No API key needed.
2. **API key label** — `X-API-Key: key-abc123` → `source=team-alpha`.
3. **Bearer token label** — `Authorization: Bearer key-abc123` → `source=team-alpha` (same lookup as API key).
4. **Fallback** — `source=unknown` if the credential has no label.

## Source tag (MQTT)

The MQTT CONNECT password is verified against `MQTT_CREDENTIALS`. The label stored at connect time is attached to every PUBLISH from that client connection.

## InfluxDB query by source

```flux
from(bucket: "metrics")
  |> range(start: -1h)
  |> filter(fn: (r) => r["source"] == "team-alpha")
```

## Grafana dashboard

In Grafana, add a variable `source` with query:

```flux
import "influxdata/influxdb/schema"
schema.tagValues(bucket: "metrics", tag: "source")
```

Then filter every panel by `${source}` to get per-team drill-downs.

## Issuing per-team certificates (mTLS)

See [cert-manager.md](cert-manager.md) — each certificate's `commonName` becomes the `source` tag. Certificate-authenticated requests skip the API key check entirely.
