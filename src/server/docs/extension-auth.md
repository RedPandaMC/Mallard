# Extension Auth Contract

The full specification moved to the documentation site so it can't drift from
the copy users read there:

**[Authentication & Identity Reference](https://redpandamc.github.io/Mallard/reference/extension-auth)**
(source: [`docs/reference/extension-auth.md`](../../../docs/reference/extension-auth.md))

Quick summary of the model:

- **API key / Bearer token** — looked up in the `API_KEYS` store
  (`label:secret` pairs); the label becomes the InfluxDB `source` tag.
  Bearer tokens are NOT validated against an IdP — the exact value must be
  registered in `API_KEYS`.
- **mTLS cert** — CN mapped through the optional `CERT_LABELS` store
  (`label:cn`), falling back to the CN itself. The server accepts a bare CN
  or a full subject DN in the `SSL_CLIENT_S_DN_CN` header.
- **MQTT** — one shared `MQTT_PASSWORD`; everything ingested over MQTT is
  tagged `source='mqtt'`. The CONNECT username is metadata only.
- **Webhook signing (optional)** — set `WEBHOOK_HMAC_SECRETS` (comma-separated
  for rotation) to require an `X-Mallard-Signature-256: sha256=<hex>`
  HMAC-SHA256 body signature on every ingest request. Empty disables it.

Labels live server-side in the secret manager; the extension only ever sends
credentials.
