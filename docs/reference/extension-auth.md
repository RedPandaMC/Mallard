# Authentication & Identity Reference

The self-hosted Mallard server supports four authentication methods. The method you choose controls what the extension sends and what `source` label is written to InfluxDB — the tag that lets Grafana dashboards break down spend by team member, machine, or CI pipeline without a separate configuration step per dashboard.

## Supported auth methods

| Method | Transport | What the extension sends | Server validates against |
|---|---|---|---|
| API key | HTTP webhook | `X-API-Key: <key>` header | `API_KEYS` / live secret store |
| MQTT password | MQTT/WSS | CONNECT password field | `MQTT_CREDENTIALS` / live secret store |
| Bearer token | HTTP webhook | `Authorization: Bearer <token>` | same hash store as API key |
| mTLS certificate | HTTP + MQTT | Client TLS certificate | CA cert issued by `mallard-ca` |

## API key (current)

**Extension setting:** `mallard.webhook.apiKey`

The extension sends this header on every `POST /api/v1/ingest`:

```
X-API-Key: <api-key>
```

The key is looked up in the server's credential store. The label associated with the key becomes the `source` tag in InfluxDB. Example store entry: `team-alpha:key-abc123` → `source=team-alpha`.

## Bearer token (current)

**Extension setting:** `mallard.webhook.bearerToken`

Alternative to `X-API-Key`. Send as:

```
Authorization: Bearer <token>
```

The token value is treated identically to an API key — it goes through the same hash lookup. This allows the extension to use a token obtained from an IdP (Infisical machine token, OpenBao token, OAuth access token) directly.

## MQTT password (current)

**Extension settings:** `mallard.mqtt.username`, `mallard.mqtt.password`

Sent as the MQTT CONNECT `password` field over `wss://<host>/mqtt`. The `username` field is accepted but the server only validates the password. Credential format: `label:password` — same structure as API key.

## mTLS client certificate (current)

**Extension settings:** `mallard.shared.certificate.file`, `mallard.shared.certificate.keyFile`

The extension presents a client certificate when establishing the TLS connection. The certificate must be issued by the server operator using the `mallard-ca` ClusterIssuer.

The CN (Common Name) field of the certificate becomes the `source` tag — no separate API key is needed.

**Server side:**
- nginx Ingress: `auth-tls-*` annotations forward `SSL_CLIENT_S_DN_CN` as a request header.
- Caddy (Docker Compose): `tls { client_auth { mode verify_if_given } }` with `request_header SSL_CLIENT_S_DN_CN {tls_client_subject}`.
- The ingest router checks this header first and uses it as `source` if present.

**Certificate provisioning (operator):**

```bash
# Issue a cert via cert-manager
kubectl apply -f client-cert.yaml

# Export for distribution to the user
kubectl get secret mallard-client-team-alpha-tls -n mallard \
  -o jsonpath='{.data.tls\.crt}' | base64 -d > team-alpha.crt
kubectl get secret mallard-client-team-alpha-tls -n mallard \
  -o jsonpath='{.data.tls\.key}' | base64 -d > team-alpha.key
```

## Named credentials and the `source` tag

Every API key, MQTT password, and certificate maps to a `source` tag written on each
InfluxDB data point:

| Auth method | Source of the `source` tag |
| --- | --- |
| API key (static) | The label in `API_KEYS=label:key` |
| MQTT password (static) | The label in `MQTT_CREDENTIALS=label:password` |
| Bearer token | Treated as an API key — the label from the credential store |
| mTLS client certificate | The Common Name (CN) field of the certificate |
| Infisical / OpenBao | Same label format, fetched live from the secret store |
| Unlabelled key (bare secret) | `"unknown"` |

Format: `label:secret`, comma-separated for multiple identities:

```bash
# .env (Docker Compose)
API_KEYS=alice:key-abc123,bob:key-def456,ci-pipeline:key-ghi789
MQTT_CREDENTIALS=alice:mqtt-pass1,ci-pipeline:mqtt-pass2
```

Labels are arbitrary strings — usernames, machine names, team names, whatever fits your
naming convention.

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

## Per-team Grafana dashboards

The pre-built Grafana dashboards include a `source` variable that drives all panels.
Select a source from the dropdown to filter the entire dashboard to one identity. To add
a new source, add a new labelled credential — Grafana queries InfluxDB for the distinct
list of `source` values dynamically, so no dashboard edit is needed.

## Auth precedence on the server (HTTP)

1. `SSL_CLIENT_S_DN_CN` header (set by TLS terminator when client cert is present) → `source = cert CN`
2. `X-API-Key` header → `source = label from credential store`
3. `Authorization: Bearer <token>` → `source = label from credential store`
4. None of the above → `401 Unauthorized`

The extension should send exactly one credential per request. Sending both a cert and an API key is valid (the cert takes precedence), but is not necessary.

## Backward compatibility

Clients using the old single-valued `API_KEYS=key1,key2` format (no labels) still work. The server assigns `source=unknown` to bare keys. Upgrade to labeled format to get per-team InfluxDB tagging.
