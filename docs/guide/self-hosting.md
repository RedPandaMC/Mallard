# Self-hosted Server

Mallard ships an optional ingest server that receives metric payloads from one or more extension instances, stores them in InfluxDB, and visualises them in Grafana. It is entirely optional — the extension works without it.

Source: `server/` in this repo.

## Quick start (Docker Compose)

```bash
cd server/docker
cp .env.example .env
# Edit .env — set INFLUX_TOKEN, API_KEYS, GF_SECURITY_ADMIN_PASSWORD
docker compose up -d
```

The stack exposes a single HTTPS endpoint via Caddy. For local dev a self-signed cert is issued automatically. For a real domain set `SERVER_DOMAIN=your.hostname` and `ACME_EMAIL=you@example.com` — Caddy obtains a Let's Encrypt certificate automatically.

| Service | URL |
|---|---|
| Ingest API | `https://your-server/api/v1/ingest` |
| Grafana | `https://your-server/grafana` |

## Connecting the extension

Configure the extension to send to your server:

```json
"mallard.metricExport.webhook.url": "https://your-server/api/v1/ingest",
"mallard.metricExport.webhook.apiKey": "your-api-key"
```

`apiKey` is sent as the `X-API-Key` header on every request. Use the same value you put in `API_KEYS` in `.env`.

## Named credentials and InfluxDB source tag

Each key in `API_KEYS` can carry a label that appears as the `source` tag in InfluxDB:

```bash
# .env
API_KEYS=team-alpha:key-abc123,team-beta:key-def456
```

Every data point written by `team-alpha` will have `source=team-alpha`, enabling per-team Grafana dashboards and Flux queries:

```flux
from(bucket: "metrics")
  |> range(start: -7d)
  |> filter(fn: (r) => r["source"] == "team-alpha")
```

MQTT credentials follow the same format: `MQTT_CREDENTIALS=alice:mqtt-pass1`.

## MQTT WebSocket

Enable the embedded MQTT broker and configure the extension to use it:

```bash
# .env
MQTT_ENABLED=true
MQTT_CREDENTIALS=alice:my-password
```

```json
"mallard.metricExport.brokerUrl": "wss://your-server/mqtt",
"mallard.metricExport.username": "alice"
```

Then run **Mallard: Set MQTT Export Password** in the Command Palette to store the password.

## Kubernetes

```bash
# Install cert-manager (Let's Encrypt + internal CA for mTLS)
helm repo add jetstack https://charts.jetstack.io --force-update
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace --set crds.enabled=true
kubectl apply -f server/k8s/cert-manager/

# Apply manifests
kubectl apply -f server/k8s/namespace.yaml
kubectl apply -f server/k8s/secrets.yaml   # copy from secrets.yaml.example
kubectl apply -f server/k8s/influxdb/
kubectl apply -f server/k8s/server/
kubectl apply -f server/k8s/grafana/
kubectl apply -f server/k8s/ingress.yaml
```

Credential rotation on K8s is handled by Stakater Reloader — update the `mallard-server-secrets` Secret and the pods roll automatically with zero downtime (HPA min=2, PDB minAvailable=1).

## Dynamic credentials (optional)

Two self-hosted secret managers are supported as optional overlays. When active, `API_KEYS` and `MQTT_CREDENTIALS` are fetched from the secret manager (30-second TTL cache) — rotation requires no restart.

| Manager | Docker Compose | Kubernetes |
|---|---|---|
| Infisical | `docker compose -f docker-compose.yml -f docker-compose.infisical.yml up -d` | `kubectl apply -k server/k8s/infisical/` |
| OpenBao | `docker compose -f docker-compose.yml -f docker-compose.openbao.yml up -d` | `kubectl apply -k server/k8s/openbao/` |

Set `SECRET_MANAGER_TYPE=infisical` or `SECRET_MANAGER_TYPE=openbao` plus the corresponding URL and token. See `server/k8s/infisical/README.md` and `server/k8s/openbao/install.md` for details.

## mTLS (optional)

For certificate-based auth without an API key, provision a client cert via cert-manager:

```bash
kubectl apply -f server/k8s/cert-manager/client-cert-template.yaml
```

The cert's Common Name becomes the `source` tag. Configure the extension with the exported cert:

```json
"mallard.metricExport.certPath": "/path/to/client.crt",
"mallard.metricExport.keyPath": "/path/to/client.key",
"mallard.metricExport.caPath": "/path/to/ca.crt"
```

See `server/k8s/cert-manager/README.md` for full provisioning steps.
