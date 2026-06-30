# Mallard Server

A self-hosted ingest server for the Mallard VS Code extension. It receives metric payloads over HTTP webhook and/or MQTT WebSocket, tags each data point with the sender's identity, and writes to InfluxDB for visualization in Grafana.

## Quick starts

- [Docker Compose](docs/quickstart-docker.md) — local dev or single-host production
- [Kubernetes](docs/quickstart-kubernetes.md) — cert-manager, Ingress, HPA, PDB

## Architecture

See [docs/architecture.md](docs/architecture.md) for a full ASCII diagram and component role descriptions.

```
VS Code Extension
  ├── HTTPS POST /api/v1/ingest  →  FastAPI  ─┐
  └── WSS /mqtt (MQTT)           →  amqtt   ──┼──→  InfluxDB  →  Grafana
                                               └─── CredentialVerifier
```

Caddy (Docker Compose) or nginx Ingress (Kubernetes) terminate TLS.

---

## Configuration reference

All settings are environment variables. In Docker Compose, set them in `.env`. In Kubernetes, use the `mallard-server-secrets` Secret and `mallard-server-config` ConfigMap.

### Core

| Variable | Required | Default | Description |
|---|---|---|---|
| `INFLUX_URL` | yes | — | InfluxDB base URL (e.g. `http://influxdb:8086`) |
| `INFLUX_TOKEN` | yes | — | InfluxDB API token with write access to the bucket |
| `INFLUX_ORG` | no | `mallard` | InfluxDB organisation |
| `INFLUX_BUCKET` | no | `metrics` | InfluxDB bucket |
| `API_KEYS` | yes* | — | `label:key` pairs, comma-separated (e.g. `team-alpha:abc123`) |
| `LOG_LEVEL` | no | `INFO` | `DEBUG\|INFO\|WARNING\|ERROR\|CRITICAL` |
| `RATE_LIMIT` | no | `60/minute` | Per-key rate limit (slowapi format) |

*Not required when using a secret manager (`SECRET_MANAGER_TYPE` ≠ `""`).

### MQTT

| Variable | Required | Default | Description |
|---|---|---|---|
| `MQTT_ENABLED` | no | `false` | Enable the embedded amqtt broker |
| `MQTT_PORT` | no | `8083` | WebSocket port for MQTT |
| `MQTT_CREDENTIALS` | no | — | `label:password` pairs — separate from `API_KEYS` |

### Secret management

| Variable | Required | Default | Description |
|---|---|---|---|
| `SECRET_MANAGER_TYPE` | no | `""` | `""` (static env) \| `"infisical"` \| `"openbao"` |
| `SECRET_MANAGER_URL` | no | — | Base URL of the secret manager instance |
| `SECRET_MANAGER_TOKEN` | no | — | Auth token for the secret manager |
| `SECRET_MANAGER_CA_CERT_PATH` | no | — | Path to CA cert for TLS verification |
| `INFISICAL_PROJECT_ID` | no | — | Infisical project UUID |
| `INFISICAL_ENV_SLUG` | no | `prod` | Infisical environment slug |
| `OPENBAO_SECRET_PATH` | no | `secret/data/mallard/server` | KV path in OpenBao |
| `OPENBAO_NAMESPACE` | no | `""` | OpenBao namespace (leave empty for community edition) |

---

## Named credentials and identity tagging

Credentials use a `label:secret` format. The label becomes the `source` tag in InfluxDB, enabling per-team dashboards and quota tracking.

```bash
API_KEYS=team-alpha:key-abc123,team-beta:key-def456
MQTT_CREDENTIALS=alice:mqtt-pass1,ci-pipeline:mqtt-pass2
```

Bare values (no label) get `source=unknown`. See [docs/identity-tagging.md](docs/identity-tagging.md).

---

## Authentication methods

The server accepts three credential types (HTTP):

1. **API key** — `X-API-Key: <key>` header
2. **Bearer token** — `Authorization: Bearer <key>` (same key lookup as API key)
3. **mTLS certificate** — client cert CN is used as `source`; no API key needed

For MQTT: CONNECT password is verified against `MQTT_CREDENTIALS`.

See [docs/extension-auth.md](docs/extension-auth.md) for the full auth contract used by the VS Code extension.

---

## TLS

### Docker Compose

Caddy provides automatic TLS. For local dev, `tls internal` issues a self-signed cert.

For production, set `SERVER_DOMAIN=your.hostname` and `ACME_EMAIL=you@example.com` in `.env` — Caddy obtains and auto-renews a Let's Encrypt certificate.

### Kubernetes

cert-manager automates TLS. See [docs/cert-manager.md](docs/cert-manager.md) for:
- Issuer selection (staging / prod / selfsigned / internal CA)
- mTLS client certificate issuance and distribution

---

## Secret management

Two self-hosted secret managers are supported as optional overlays:

| Manager | Docs |
|---|---|
| Infisical | [docs/secret-management-infisical.md](docs/secret-management-infisical.md) |
| OpenBao | [docs/secret-management-openbao.md](docs/secret-management-openbao.md) |

When a secret manager is active, `API_KEYS` and `MQTT_CREDENTIALS` env vars are ignored — credentials are fetched from the manager with a 30-second TTL cache. Rotation requires no restart.

---

## API

### `POST /api/v1/ingest`

Rate-limited per credential. Body must be ≤ 64 KB.

Returns `202 Accepted` on success, `401 Unauthorized` for bad credentials, `503 Service Unavailable` if InfluxDB is unreachable.

```json
{
  "instance_id": "abc123",
  "schema_version": 2,
  "ts": 1750000000000,
  "credits_velocity_per_hour": 18.4,
  "mtd_budget_pct": 0.34,
  "mtd_credits": 120.5,
  "mtd_cost_usd": 4.82,
  "today_credits": 22.3,
  "today_cost_usd": 0.89,
  "active_models": ["claude-sonnet-4-6", "gpt-4o"],
  "top_model": "claude-sonnet-4-6"
}
```

### `GET /health`

Returns `{"status": "ok"|"degraded", "influx": "pong"|"error"}`. Always HTTP 200.

---

## Security

- Credentials are SHA-256 hashed in memory at startup; raw values are never stored or logged.
- All comparisons use `hmac.compare_digest` to prevent timing attacks.
- Rate limiting is per-credential, not per-IP (handles NAT/shared IPs correctly).
- Docker Compose: backend services run on an internal network; Caddy is the only publicly reachable service.
- Kubernetes: NetworkPolicy enforces default-deny with explicit allowlist rules; the server pod runs as non-root with a read-only filesystem.

---

## Operations

See [docs/operations.md](docs/operations.md) for:
- Credential rotation (static and remote)
- Scaling with HPA and PDB
- InfluxDB backup
- Log level configuration

---

## Running tests

```bash
cd server
pip install uv
uv pip install -e ".[dev]"
pytest tests/ -v --cov=src --cov-report=term-missing
```

All new Python code maintains 100% test coverage. Property-based fuzz tests run with `pytest tests/fuzz/`.
