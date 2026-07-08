# Secret Management

Mallard's server reads its credentials from environment variables by default — a plain `.env` file with Docker Compose, or a Kubernetes Secret. This static backend (`SECRET_MANAGER_TYPE=static`, the default) is a complete production setup, not a dev-mode shortcut: the keys are hashed in memory, never logged, and rotated by updating the env source and restarting.

If you rotate credentials often enough that a restart per rotation hurts, **OpenBao** is the supported advanced backend. The server then fetches credentials live with a 30-second in-memory cache, so:

- Adding a key → visible within 30 seconds, no restart.
- Revoking a key → rejected within 30 seconds, no restart.

Start static. Move to OpenBao when rotation frequency — not architecture taste — demands it.

## Static credentials (the default)

Credentials live in the same env source as the rest of the server config, in the `label:secret` format used everywhere in Mallard:

```
API_KEYS=alice:key-abc123,bob:key-def456
MQTT_PASSWORD=shared-broker-password
CERT_LABELS=alice:client-cert-cn
WEBHOOK_HMAC_SECRETS=signing-secret-1
```

### Docker Compose

```bash
cd server/docker
cp .env.example .env
# Fill in the credentials block, then:
docker compose -f docker-compose.yml up -d
```

### Kubernetes

Fill in `server/k8s/secrets.yaml.example` (the `mallard-server-secrets` Secret carries `API_KEYS` and friends), apply it, then:

```bash
kubectl apply -k server/k8s/server/
```

### Rotation

1. Update the `.env` file or the `mallard-server-secrets` Secret.
2. Docker Compose: `docker compose restart server`. Kubernetes: Stakater Reloader notices the Secret change and rolls the Deployment automatically — with HPA min=2 and the PDB, that's zero downtime.

During a rotation window, list the old and new key side by side (`alice:old-key,alice-new:new-key`) so clients can switch over before you remove the old one.

## OpenBao (advanced: live rotation)

[OpenBao](https://openbao.org) is a community fork of HashiCorp Vault, API-compatible with Vault KV v2, single-licensed under [MPL-2.0](https://github.com/openbao/openbao/blob/main/LICENSE) and governed by the Linux Foundation / OpenSSF — no enterprise tier gating any feature. Choose it if you already operate a Vault cluster or genuinely need restart-free rotation.

::: warning Sealed after every restart
OpenBao starts *sealed*: after any pod or container restart, someone must run the unseal ceremony (3 of 5 key shares) before the server can fetch credentials again. Until then `/health` stays green but every ingest fails 503 once the 30-second cache goes cold. If nobody will notice and unseal promptly, stay on the static backend — a Kubernetes Secret has no such failure mode.
:::

### How the live fetch works

With `SECRET_MANAGER_TYPE=openbao`, the server instantiates `OpenBaoCredentialVerifier`:

1. On the first inbound request after startup (or after the 30-second TTL expires), the verifier fetches the secret store from OpenBao.
2. The fetched store is kept in memory for 30 seconds; requests within that window make no network round-trip.
3. If a refresh fails (OpenBao unreachable or sealed), the old cache is retained and an error is logged; the server keeps serving until the cache goes cold.

### Docker Compose

The `docker-compose.openbao.yml` overlay starts OpenBao in dev mode (in-memory, no persistence; for production use a real OpenBao/Vault cluster) and an `openbao-init` one-shot container that seeds secrets from your `.env`.

```bash
cd server/docker
cp .env.example .env
# Fill in the credentials block and OPENBAO_DEV_ROOT_TOKEN, then:
docker compose -f docker-compose.yml -f docker-compose.openbao.yml up -d
```

The `openbao-init` container enables KV v2 and writes a secret at `secret/data/mallard/server` using the values from your `.env`. After startup, manage secrets through the OpenBao UI at `http://localhost:8200` or with the `bao` CLI:

```bash
# List current credentials
bao kv get secret/mallard/server

# Add or rotate a key
bao kv patch secret/mallard/server api_keys="alice:new-key,bob:key-def456"
# The server picks up the change within 30 seconds, no restart needed
```

### Kubernetes

The server talks to OpenBao directly — the same live-fetch code path as Docker Compose, pointed at an in-cluster OpenBao instance. No Vault Agent Injector or sidecar is installed.

```bash
helm repo add openbao https://openbao.github.io/openbao-helm
helm install openbao openbao/openbao \
  --namespace openbao --create-namespace \
  --set server.ha.enabled=true \
  --set server.ha.raft.enabled=true
```

Initialise, unseal, then set up AppRole and get a client token with the provided script:

```bash
kubectl exec -n openbao openbao-0 -- bao operator init -key-shares=5 -key-threshold=3
kubectl exec -n openbao openbao-0 -- bao operator unseal <unseal-key>

export BAO_ADDR=http://openbao.openbao.svc.cluster.local:8200
export BAO_TOKEN=<root-token>
./server/k8s/openbao/approle-setup.sh

bao kv put secret/mallard/server \
  api_keys="alice:key-abc123,bob:key-def456" \
  mqtt_password="shared-broker-password"
```

`approle-setup.sh` prints a client token at the end:

```bash
kubectl create secret generic mallard-openbao-secrets \
  --from-literal=SECRET_MANAGER_TOKEN=<client-token> \
  -n mallard

kubectl apply -k server/k8s/openbao/
```

The overlay sets `SECRET_MANAGER_TYPE=openbao` and `SECRET_MANAGER_URL` on the server Deployment and wires in the Secret above. See `server/k8s/openbao/install.md` for the full walkthrough, including client token expiry and renewal.

Rotating OpenBao's own access token (`SECRET_MANAGER_TOKEN`) still needs a restart: it's a Secret value the server reads once at startup. Stakater Reloader handles that automatically when you update `mallard-openbao-secrets`.

## Migrating from Infisical

Infisical support was removed: it required a Postgres + Redis stack of its own to hold a handful of key-value credentials, and everything it did for Mallard the static backend or OpenBao does with less to operate. If you were running `SECRET_MANAGER_TYPE=infisical`, the server now refuses to start with a clear validation error. Copy the `API_KEYS` / `MQTT_PASSWORD` / `CERT_LABELS` / `WEBHOOK_HMAC_SECRETS` values out of your Infisical project into your `.env` or `mallard-server-secrets` Secret (static), or into OpenBao's KV store, and set `SECRET_MANAGER_TYPE` accordingly.

## Operational visibility

Neither the env source nor OpenBao's UI knows anything about Mallard's ingest traffic. For that, use what the stack already ships instead of a separate tool:

- `GET /health` reports `min_known_schema_version`/`max_known_schema_version` so you can spot extension version skew across a fleet at a glance.
- The Grafana dashboards break down ingest volume by the `connector` and `schema_version` InfluxDB tags, so you can see per-connector traffic and version skew visually without leaving the dashboard you already have open.
