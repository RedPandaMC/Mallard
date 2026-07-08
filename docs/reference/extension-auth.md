# Authentication & Identity Reference

The self-hosted Mallard server supports four authentication methods, plus
optional HMAC request signing on top. The method you choose controls what the
extension sends and what `source` label is written to InfluxDB: the tag that
lets Grafana dashboards break down spend by team member, machine, or CI
pipeline without a separate configuration step per dashboard.

Labels are configured entirely server-side, in the secret manager. The
extension never sends a label — it sends a credential, and the server maps
that credential to whoever it was issued to. Think of it as a tracking cookie
the operator hands out: give team A key A, and everything sent with key A is
tagged `source=team-a`.

## Supported auth methods

| Method | Transport | What the extension sends | Server validates against |
|---|---|---|---|
| API key | HTTP webhook | `X-API-Key: <key>` header | `API_KEYS` in the secret store |
| Bearer token | HTTP webhook | `Authorization: Bearer <token>` | same store as API keys |
| mTLS certificate | HTTP + MQTT | Client TLS certificate | CA trust + optional `CERT_LABELS` |
| MQTT password | MQTT/WSS | CONNECT password field | `MQTT_PASSWORD` (single shared) |

## API key

**Extension side:** run **Mallard: Set Webhook API Key** (stored in
SecretStorage; credentials never live in settings files).

The extension sends this header on every `POST /api/v1/ingest`:

```
X-API-Key: <api-key>
```

The key is looked up in the server's credential store. The label associated
with the key becomes the `source` tag in InfluxDB. Example store entry:
`team-alpha:key-abc123` → `source=team-alpha`.

## Bearer token

**Extension side:** run **Mallard: Set Webhook Bearer Token**.

Alternative to `X-API-Key`. Sent as:

```
Authorization: Bearer <token>
```

The token value is treated identically to an API key: it goes through the
same hash lookup against the `API_KEYS` store, so it must be pre-registered
there like any other key. The server does **not** validate tokens against an
identity provider — an OpenBao/OAuth token works only if its exact
value has been added to `API_KEYS`.

## mTLS client certificate

**Extension settings:** `mallard.shared.certificate.file`, `mallard.shared.certificate.keyFile`

The extension presents a client certificate when establishing the TLS
connection. The certificate must be issued by the server operator using the
`mallard-ca` ClusterIssuer.

The `source` tag comes from the certificate's CN: if the CN has an entry in
the optional `CERT_LABELS` store (`label:cn` pairs, e.g.
`ci:build-agent-01`), that label is used; otherwise the CN itself is the
source.

**Server side:**
- nginx Ingress: `auth-tls-*` annotations forward the client subject DN as the
  `SSL_CLIENT_S_DN_CN` header (via the standard `$ssl_client_s_dn` variable).
- Caddy (Docker Compose): mTLS is opt-in — uncomment the `client_auth` block in
  the Caddyfile. `request_header SSL_CLIENT_S_DN_CN {tls_client_subject}` is
  always set (empty without a cert), which also prevents header spoofing.
- The server accepts either a bare CN or a full subject DN in that header and
  extracts the CN itself.

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

## MQTT password

**Extension side:** run **Mallard: Set MQTT Export Password** (SecretStorage).

Sent as the MQTT CONNECT `password` field over `wss://<host>/mqtt`. The server
validates it against a **single shared broker password** (`MQTT_PASSWORD` in
the secret store) and tags everything ingested over MQTT with
`source='mqtt'` — there are no per-client MQTT labels. The `username` field is
sent as broker metadata but is **not** used for identification. If you need
per-team attribution, use the webhook transport with labeled API keys.

## Webhook signing (optional)

Defense-in-depth on top of any HTTP auth method: when enabled, every ingest
request must carry an HMAC-SHA256 signature of the exact request body.

- **Extension side:** run **Mallard: Set Webhook Signing Secret**. The
  extension then adds `X-Mallard-Signature-256: sha256=<hex>` to every POST.
- **Server side:** set `WEBHOOK_HMAC_SECRETS` in the secret store to one or
  more comma-separated secrets. Empty (the default) disables checking
  entirely — the feature is opt-in and backward compatible. A request with a
  missing or invalid signature is rejected with `401 Invalid signature`.
- **Rotation:** list the new secret alongside the old one
  (`new-secret,old-secret`), roll clients over to the new value, then remove
  the old entry. The server accepts a signature made with any listed secret.

The signature authenticates the request body; the API key still identifies
the sender. Signing does not replace auth — requests without valid
credentials are rejected before the signature is ever checked.

## Named credentials and the `source` tag

Every request maps to a `source` tag written on each InfluxDB data point:

| Auth method | Source of the `source` tag |
| --- | --- |
| API key | The label in `API_KEYS=label:key` |
| Bearer token | Treated as an API key: the label from the credential store |
| mTLS client certificate | `CERT_LABELS` entry for the CN, else the CN itself |
| MQTT password | Always `mqtt` |
| Unlabelled key (bare secret) | `"unknown"` |

Format for API keys: `label:secret`, comma-separated for multiple identities;
`CERT_LABELS` uses `label:cn`:

```bash
# Seeded into the secret manager (see the self-hosting guide)
API_KEYS=alice:key-abc123,bob:key-def456,ci-pipeline:key-ghi789
CERT_LABELS=ci:build-agent-01
MQTT_PASSWORD=shared-broker-password
WEBHOOK_HMAC_SECRETS=
```

Labels are arbitrary strings: usernames, machine names, team names, whatever
fits your naming convention.

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
a new source, add a new labelled credential. Grafana queries InfluxDB for the distinct
list of `source` values dynamically, so no dashboard edit is needed.

## Auth precedence on the server (HTTP)

1. `SSL_CLIENT_S_DN_CN` header (set by TLS terminator when client cert is present) → `source` from `CERT_LABELS`, else the CN
2. `X-API-Key` header → `source = label from credential store`
3. `Authorization: Bearer <token>` → `source = label from credential store`
4. None of the above → `401 Unauthorized`

When `WEBHOOK_HMAC_SECRETS` is configured, the signature check runs after
authentication succeeds, on the raw request body.

The extension should send exactly one credential per request. Sending both a cert and an API key is valid (the cert takes precedence), but is not necessary.

## Bare (unlabeled) keys

`API_KEYS` entries without a `label:` prefix are accepted and tagged
`source=unknown`. Use the labeled format if you want per-team InfluxDB tagging.

This covers authentication only. The ingest payload body is versioned separately via a `schema_version` field; the Metrics Schema reference page covers how old, current, and unrecognized future payload versions are all accepted.
