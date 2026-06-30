# Identity Tagging

Every metric payload written to InfluxDB carries a `source` tag that identifies who sent it. This lets Grafana dashboards break down spend by team member, machine, CI pipeline, or any other identity you define — without a separate configuration step per dashboard.

---

## How identities are assigned

The `source` tag is determined by the auth method:

| Auth method | Source of the `source` tag |
|---|---|
| API key (static) | The label in `API_KEYS=label:key` |
| MQTT password (static) | The label in `MQTT_CREDENTIALS=label:password` |
| Bearer token | Treated as an API key — the label from the credential store |
| mTLS client certificate | The Common Name (CN) field of the certificate |
| Infisical / OpenBao | Same label format, fetched live from the secret store |
| Unlabelled key (bare secret) | `"unknown"` |

---

## Named credentials

The credential format is `label:secret`, comma-separated for multiple identities:

```bash
# .env (Docker Compose)
API_KEYS=alice:key-abc123,bob:key-def456,ci-pipeline:key-ghi789
MQTT_CREDENTIALS=alice:mqtt-pass1,ci-pipeline:mqtt-pass2
```

Labels are arbitrary strings — use usernames, machine names, team names, or whatever fits your naming convention. They appear verbatim as the `source` tag in InfluxDB.

When a credential has no label (just a bare secret with no `:` separator), the server defaults to `"unknown"`. All `"unknown"` data points are aggregated together, which makes it hard to distinguish sources — prefer always using labels.

---

## Querying by source in Flux

```flux
// Total credits used by Alice in the last 7 days
from(bucket: "metrics")
  |> range(start: -7d)
  |> filter(fn: (r) => r["_measurement"] == "mallard_metrics" and r["source"] == "alice")
  |> sum()

// Compare spend across all team members in a single query
from(bucket: "metrics")
  |> range(start: -30d)
  |> filter(fn: (r) => r["_measurement"] == "mallard_metrics")
  |> group(columns: ["source"])
  |> sum()
```

---

## mTLS identities

When the extension authenticates with a TLS client certificate, the server reads the certificate's Common Name from the `SSL_CLIENT_S_DN_CN` header (forwarded by the nginx ingress) and uses it as `source`. No entry in `API_KEYS` is needed.

This approach has a useful property: you issue one certificate per team member (or machine), and the identity is cryptographically bound to the private key. If you revoke the certificate, the identity disappears immediately — no stale API key lingering in a `.env` file.

See [cert-manager — client certificates](/guide/cert-manager#client-certificates) for how to issue and distribute certificates.

---

## Per-team Grafana dashboards

The pre-built Grafana dashboards include a `source` variable that drives all panels. Select a source from the dropdown to filter the entire dashboard to one identity.

To add a new source to the dropdown, just add a new labelled credential — Grafana queries InfluxDB for the distinct list of `source` values dynamically, so no dashboard edit is needed.

---

## Source priority

If a request includes both a client certificate CN and an API key, the certificate CN takes priority. This matters if you have a transitional period where clients might send both.

Priority order (highest first):
1. TLS client certificate CN (`SSL_CLIENT_S_DN_CN` header)
2. API key label (`X-API-Key` or `Authorization: Bearer` header)
3. `"unknown"` (fallback)
