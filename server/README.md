# Mallard BYO Server

A self-hosted ingest server that receives metric payloads from multiple Mallard VS Code extension instances, stores them in InfluxDB v2, and visualises them in Grafana.

## Architecture

```
Mallard extension
  ├── HTTPS POST /api/v1/ingest  →  FastAPI  →  InfluxDB v2  →  Grafana
  └── MQTT (optional)            →  Mosquitto  →  FastAPI subscriber  →  InfluxDB v2
                                                                 ↑
                                                           Caddy TLS proxy
```

Both **Docker Compose** (local/simple) and **Kubernetes** (production) are supported.

---

## Docker Compose quickstart

**Prerequisites:** Docker 24+ and Docker Compose v2.

```bash
cd server/docker
cp .env.example .env
# Edit .env — set INFLUX_TOKEN, API_KEYS, GF_SECURITY_ADMIN_PASSWORD, and passwords
docker compose up -d
```

| Service | URL |
|---------|-----|
| Mallard ingest API | https://localhost (Caddy TLS proxy) |
| Grafana | https://localhost/grafana (proxied by Caddy) |
| InfluxDB | internal only — not exposed to host |

### TLS certificates

**Local dev (default):** Caddy issues a self-signed cert via `tls internal`. Your browser will warn — add an exception, or trust the Caddy root CA (`caddy trust`).

**Production with a real domain:** edit `.env` and set:

```bash
SERVER_DOMAIN=metrics.example.com
ACME_EMAIL=you@example.com
```

Then open ports 80 and 443 to the internet. Caddy will automatically obtain and renew a Let's Encrypt certificate — no certbot, no openssl, no cronjob needed.

### Configure the extension (webhook)

```json
"mallard.metricExport.webhook.url": "https://your-server/api/v1/ingest"
```

### Configure the extension (MQTT, optional)

```json
"mallard.metricExport.brokerUrl": "mqtts://your-server:8883"
```

Run **Mallard: Set MQTT Export Password** in VS Code to store the credential.

**First-time Mosquitto password setup** (creates the password file inside the container):

```bash
docker compose run --rm mosquitto mosquitto_passwd -c /mosquitto/config/passwd "${MQTT_USERNAME}"
# Enter the password matching MQTT_PASSWORD in .env when prompted
docker compose restart mosquitto server
```

---

## Kubernetes quickstart

**Prerequisites:** kubectl, a Kubernetes cluster, cert-manager for TLS.

```bash
kubectl apply -f server/k8s/namespace.yaml
kubectl apply -f server/k8s/resourcequota.yaml

# Fill in secrets.yaml.example and apply (never commit real values)
cp server/k8s/secrets.yaml.example server/k8s/secrets.yaml
# Edit secrets.yaml with real values
kubectl apply -f server/k8s/secrets.yaml

kubectl apply -f server/k8s/networkpolicy.yaml
kubectl apply -f server/k8s/influxdb/
kubectl apply -f server/k8s/mosquitto/
kubectl apply -f server/k8s/server/
kubectl apply -f server/k8s/grafana/
kubectl apply -f server/k8s/ingress.yaml
```

Update `server/k8s/ingress.yaml` with your real hostname before applying.

### Autoscaling

The server deployment is managed by a HorizontalPodAutoscaler (min 2, max 10 replicas, CPU target 60%). A PodDisruptionBudget ensures at least 1 pod stays available during rolling updates:

```bash
kubectl get hpa -n mallard
kubectl get pdb -n mallard
```

### Mosquitto on Kubernetes

Create the password secret before applying the Mosquitto deployment:

```bash
# Generate the passwd file content
docker run --rm eclipse-mosquitto:2 mosquitto_passwd -c /dev/stdout <username> | \
  kubectl create secret generic mosquitto-passwd --from-file=passwd=/dev/stdin -n mallard
```

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
| `LOG_LEVEL` | no | `INFO` | `DEBUG\|INFO\|WARNING\|ERROR\|CRITICAL` |
| `MQTT_BROKER_URL` | no | — | Enables MQTT subscriber (e.g. `mqtt://mosquitto:1883`) |
| `MQTT_TOPIC` | no | `mallard/metrics` | MQTT topic to subscribe to |
| `MQTT_USERNAME` | no | — | MQTT broker username |
| `MQTT_PASSWORD` | no | — | MQTT broker password |

---

## API

### `POST /api/v1/ingest`

Requires `X-API-Key` header. Rate-limited to 60 req/min per key. Body must be ≤ 64 KB.

Returns `202 Accepted` on success, `503 Service Unavailable` if InfluxDB is unreachable.

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

Returns `{"status": "ok"|"degraded", "influx": "pong"|"error"}`. Always HTTP 200 so Kubernetes does not restart on transient InfluxDB blips.

---

## Security

- API keys are hashed (SHA-256) in memory at startup; the raw value is never stored or logged.
- All comparisons use `hmac.compare_digest` to prevent timing attacks.
- Only `https://` webhook URLs and `mqtts://`/`wss://` MQTT URLs are accepted by Mallard.
- Rate limiting is per-key, not per-IP, to handle NAT/shared IPs correctly.
- The `X-API-Key` header is never logged; only the first 8 chars of its SHA-256 hash appear in debug logs.
- Docker Compose: backend services run on an `internal` bridge network with no outbound internet access; Caddy is the only publicly reachable service.
- Kubernetes: NetworkPolicy enforces default-deny ingress with explicit allowlist rules between services.

---

## Grafana

The Grafana dashboard (`grafana/dashboards/mallard-overview.json`) is auto-provisioned on startup. Set `GF_SECURITY_ADMIN_PASSWORD` in `.env` before first launch — the default `admin/admin` is not accepted.

---

## Running tests

```bash
cd server
pip install uv && uv pip install -e ".[dev]"
pytest tests/ -v
```

Property-based fuzz tests use [Hypothesis](https://hypothesis.readthedocs.io/) — run with `pytest tests/fuzz/`.
