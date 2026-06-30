# Quickstart — Docker Compose

## Prerequisites

- Docker Engine ≥ 24 with Compose V2
- A domain name (optional — `localhost` works for local dev)

## Steps

### 1. Clone and configure

```bash
git clone https://github.com/redpandamc/mallard.git
cd mallard/server/docker
cp .env.example .env
```

Edit `.env` and set at minimum:

| Variable | Description |
|---|---|
| `INFLUX_ADMIN_PASSWORD` | Strong password for the InfluxDB admin account |
| `INFLUX_TOKEN` | Long random string — used by the server to write metrics |
| `API_KEYS` | `label:key` pairs, e.g. `my-machine:abc123` |
| `GF_SECURITY_ADMIN_PASSWORD` | Grafana admin password |

### 2. Start the stack

```bash
docker compose up -d
```

Services:
- Mallard server: `https://localhost/api/v1/ingest`
- Grafana: `https://localhost/grafana`
- InfluxDB: `http://localhost:8086` (internal only by default)

### 3. Test the ingest endpoint

```bash
curl -k -X POST https://localhost/api/v1/ingest \
  -H "X-API-Key: abc123" \
  -H "Content-Type: application/json" \
  -d '{"measurement":"keystrokes","fields":{"count":42}}'
# → 202 Accepted
```

### 4. Open Grafana

Browse to `https://localhost/grafana` and log in with `admin` / your `GF_SECURITY_ADMIN_PASSWORD`.

The default dashboard shows ingested metrics tagged by `source`.

## MQTT

```bash
# In .env:
MQTT_ENABLED=true
MQTT_CREDENTIALS=alice:my-mqtt-password

# Reconnect after .env change:
docker compose up -d server
```

Test with any MQTT client (e.g. `mqttx`):

```bash
mqttx pub -h localhost -p 8083 -P my-mqtt-password \
  --protocol wss --path /mqtt \
  -t mallard/ingest -m '{"measurement":"keystrokes","fields":{"count":5}}'
```

## Real domain + Let's Encrypt

In `.env`:

```bash
SERVER_DOMAIN=mallard.example.com
ACME_EMAIL=ops@example.com
```

Remove the `tls internal` directive (or comment it out) from `Caddyfile` and restart.

## Secret management (optional)

Use Infisical or OpenBao to manage credentials dynamically — see:
- [secret-management-infisical.md](secret-management-infisical.md)
- [secret-management-openbao.md](secret-management-openbao.md)
