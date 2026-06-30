# Secret Management — OpenBao (self-hosted)

OpenBao is an open-source Vault fork. When enabled, Mallard's `OpenBaoCredentialVerifier` fetches credentials from OpenBao's KV v2 secrets engine on every request (with a 30-second TTL cache).

## Docker Compose (dev mode)

Dev mode stores secrets in memory and resets on container restart — useful for local testing.

```bash
# Add to .env:
SECRET_MANAGER_TYPE=openbao
OPENBAO_DEV_ROOT_TOKEN=dev-root-token  # any string in dev mode

# Start the stack (includes an openbao-init container that seeds secrets):
docker compose -f docker-compose.yml -f docker-compose.openbao.yml up -d
```

The `openbao-init` container:
1. Enables the KV v2 secrets engine at `secret/`.
2. Seeds `secret/mallard/server` from `API_KEYS`, `MQTT_CREDENTIALS`, and `INFLUX_TOKEN` in your `.env`.

## Kubernetes (HA + Raft)

See `server/k8s/openbao/install.md` for the full production setup, including initialization, unsealing, AppRole configuration, and the Agent Injector overlay.

## Credential format in OpenBao

Store credentials at `secret/mallard/server` using the `label:value` format:

```bash
bao kv put secret/mallard/server \
  api_keys="team-alpha:key-abc123,team-beta:key-def456" \
  mqtt_credentials="alice:mqtt-pass1,ci-pipeline:mqtt-pass2" \
  influx_token="your-influx-token"
```

## Credential rotation

```bash
bao kv put secret/mallard/server api_keys="team-alpha:new-key,team-beta:old-key"
```

Within 30 seconds the verifier re-fetches. To immediately revoke a token:

```bash
bao token revoke <token>
```

The next request from that token will fail authentication.

## Environment variables

| Variable | Description |
|---|---|
| `SECRET_MANAGER_TYPE` | `openbao` |
| `SECRET_MANAGER_URL` | OpenBao address (e.g. `http://openbao:8200`) |
| `SECRET_MANAGER_TOKEN` | AppRole token or root token |
| `SECRET_MANAGER_CA_CERT_PATH` | Path to CA cert for TLS (leave empty for HTTP or system CAs) |
| `OPENBAO_SECRET_PATH` | KV path (default: `secret/data/mallard/server`) |
| `OPENBAO_NAMESPACE` | Namespace header (leave empty for community edition) |
