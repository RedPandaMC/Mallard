# Extension Auth Contract

This document is the specification for the VS Code extension. It defines every authentication method the server supports, what the extension must send, and how settings should be structured. Extension changes should match this contract exactly.

## Supported auth methods

| Method | Transport | What extension sends | Server validates against | Status |
|---|---|---|---|---|
| API key | HTTP webhook | `X-API-Key: <key>` header | `API_KEYS` / live secret store | **current** |
| MQTT password | MQTT/WSS | CONNECT password field | `MQTT_CREDENTIALS` / live secret store | **current** |
| Bearer token | HTTP webhook | `Authorization: Bearer <token>` | same hash store as API key | **current** |
| mTLS certificate | HTTP + MQTT | Client TLS certificate | CA cert issued by `mallard-ca` | **current** |

---

## API key (current)

**Extension setting:** `mallard.webhook.apiKey`

The extension sends this header on every `POST /api/v1/ingest`:

```
X-API-Key: <api-key>
```

The key is looked up in the server's credential store. The label associated with the key becomes the `source` tag in InfluxDB. Example store entry: `team-alpha:key-abc123` → `source=team-alpha`.

---

## Bearer token (current)

**Extension setting:** `mallard.webhook.bearerToken`

Alternative to `X-API-Key`. Send as:

```
Authorization: Bearer <token>
```

The token value is treated identically to an API key: it goes through the same hash lookup. This allows the extension to use a token obtained from an IdP (Infisical machine token, OpenBao token, OAuth access token) directly.

---

## MQTT password (current)

**Extension settings:** `mallard.mqtt.username`, `mallard.mqtt.password`

Sent as the MQTT CONNECT `password` field over `wss://<host>/mqtt`. The `username` field is accepted but the server only validates the password. Credential format: `label:password`, same structure as API key.

---

## mTLS client certificate (current)

**Extension settings:** `mallard.shared.certificate.file`, `mallard.shared.certificate.keyFile`

The extension presents a client certificate when establishing the TLS connection. The certificate must be issued by the server operator using the `mallard-ca` ClusterIssuer (see [cert-manager.md](cert-manager.md)).

The CN (Common Name) field of the certificate becomes the `source` tag; no separate API key is needed.

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

---

## Extension settings (full schema)

```jsonc
{
  // ── Server ──────────────────────────────────────────────────────────────────
  "mallard.server.url": "https://your-server",

  // ── Transport ────────────────────────────────────────────────────────────────
  "mallard.export.transport": "webhook",  // "webhook" | "mqtt"

  // ── Webhook auth ─────────────────────────────────────────────────────────────
  "mallard.webhook.auth": "apiKey",       // "apiKey" | "bearer" | "certificate"
  "mallard.webhook.apiKey": "",           // used when auth = "apiKey"
  "mallard.webhook.bearerToken": "",      // used when auth = "bearer"
                                          // auth = "certificate" → uses shared cert below

  // ── MQTT ─────────────────────────────────────────────────────────────────────
  "mallard.mqtt.url": "",                 // override if different from server.url + /mqtt
  "mallard.mqtt.auth": "password",        // "password" | "certificate"
  "mallard.mqtt.username": "",            // used when auth = "password" (informational)
  "mallard.mqtt.password": "",            // used when auth = "password"
                                          // auth = "certificate" → uses shared cert below

  // ── Shared certificate ────────────────────────────────────────────────────────
  // Used by any transport/auth that sets auth = "certificate"
  "mallard.shared.certificate.file": "",    // path to PEM client certificate
  "mallard.shared.certificate.keyFile": "", // path to PEM private key
  "mallard.shared.certificate.caFile": ""   // CA bundle to verify the server's TLS cert
}
```

---

## Auth precedence on the server (HTTP)

1. `SSL_CLIENT_S_DN_CN` header (set by TLS terminator when client cert is present) → `source = cert CN`
2. `X-API-Key` header → `source = label from credential store`
3. `Authorization: Bearer <token>` → `source = label from credential store`
4. None of the above → `401 Unauthorized`

The extension should send exactly one credential per request. Sending both a cert and an API key is valid (the cert takes precedence), but is not necessary.

---

## Backward compatibility

Clients using the old single-valued `API_KEYS=key1,key2` format (no labels) still work. The server assigns `source=unknown` to bare keys. Upgrade to labeled format to get per-team InfluxDB tagging.
