# Mallard BYO Server

A self-hosted ingest server that receives metric payloads from multiple Mallard VS Code extension instances, stores them in InfluxDB v2, and visualises them in Grafana.

## Architecture

```
Mallard extension  →  HTTPS POST /api/v1/ingest  →  FastAPI  →  InfluxDB v2  →  Grafana
```

Both **Docker Compose** (local/simple) and **Kubernetes** (production) are supported.

---

## Docker Compose quickstart

**Prerequisites:** Docker 24+ and Docker Compose v2.

```bash
cd server/docker
cp .env.example .env
# Edit .env — set INFLUX_TOKEN, API_KEYS, passwords
docker compose up -d
```

| Service | URL |
|---------|-----|
| Mallard ingest API | https://localhost (nginx TLS proxy) |
| Grafana | http://localhost:3000 (login: admin / see .env) |
| InfluxDB | http://localhost:8086 |

On first start nginx generates a self-signed TLS certificate. Replace it with a real cert by mounting one into `/etc/nginx/certs/` or switch to Let's Encrypt.

Configure your Mallard extension:
```json
"mallard.metricExport.webhook.url": "https://your-server/api/v1/ingest"
```

Or via MQTT — set `mallard.metricExport.brokerUrl` and run **Mallard: Set MQTT Export Password**.

---

## Kubernetes quickstart

**Prerequisites:** kubectl, a Kubernetes cluster, cert-manager for TLS.

```bash
kubectl apply -f server/k8s/namespace.yaml

# Fill in secrets.yaml.example and apply (never commit real values)
cp server/k8s/secrets.yaml.example server/k8s/secrets.yaml
# Edit secrets.yaml with real values
kubectl apply -f server/k8s/secrets.yaml

kubectl apply -f server/k8s/influxdb/
kubectl apply -f server/k8s/server/
kubectl apply -f server/k8s/grafana/
kubectl apply -f server/k8s/ingress.yaml
```

Update `server/k8s/ingress.yaml` with your real hostname before applying.

---

## Configuration reference

All server settings are via environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `INFLUX_URL` | yes | — | InfluxDB base URL (e.g. `http://influxdb:8086`) |
| `INFLUX_TOKEN` | yes | — | InfluxDB API token with write+read on bucket |
| `INFLUX_ORG` | no | `mallard` | InfluxDB organisation |
| `INFLUX_BUCKET` | no | `metrics` | InfluxDB bucket |
| `API_KEYS` | yes | — | Comma-separated plaintext keys (hashed in memory at startup) |
| `SERVER_HOST` | no | `0.0.0.0` | Bind address |
| `SERVER_PORT` | no | `8080` | Port |
| `RATE_LIMIT` | no | `60/minute` | Per-key rate limit (slowapi format) |
| `LOG_LEVEL` | no | `INFO` | `DEBUG\|INFO\|WARNING\|ERROR` |

---

## API

### `POST /api/v1/ingest`

Requires `X-API-Key` header. Rate-limited to 60 req/min per key. Body must be ≤ 64 KB.

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

Returns `{"status": "ok", "influx": "pong"}`. Used as Kubernetes liveness probe.

---

## Security

- API keys are hashed (SHA-256) in memory at startup; the raw value is never stored or logged.
- All comparisons use `hmac.compare_digest` to prevent timing attacks.
- Only `https://` webhook URLs and `mqtts://`/`wss://` MQTT URLs are accepted by Mallard.
- Rate limiting is per-key, not per-IP, to handle NAT/shared IPs correctly.
- The `X-API-Key` header is never logged; only the first 8 chars of its SHA-256 hash appear in debug logs.

---

## Grafana

The Grafana dashboard (`grafana/dashboards/mallard-overview.json`) is auto-provisioned on startup. Default login: **admin / admin** — change on first login via `GF_SECURITY_ADMIN_PASSWORD`.

---

## Running tests

```bash
cd server
pip install uv && uv pip install -e ".[dev]"
INFLUX_URL=http://localhost:8086 INFLUX_TOKEN=... API_KEYS=testkey pytest -v
```

Property-based fuzz tests use [Hypothesis](https://hypothesis.readthedocs.io/) — run with `pytest tests/fuzz/`.
