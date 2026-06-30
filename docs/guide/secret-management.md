# Secret Management

By default, Mallard's server reads credentials from environment variables (`API_KEYS`, `MQTT_CREDENTIALS`, `INFLUX_TOKEN`). This works well for a single machine, but has two limitations:

1. **Rotation requires a restart.** Updating `.env` or a Kubernetes Secret only takes effect when the container is replaced.
2. **Revocation isn't instant.** There is no way to invalidate a specific key without restarting or swapping out the secret store.

Dynamic secret managers solve both problems. The server fetches live credentials on each request (with a 30-second in-memory cache) so that:
- Adding a key → visible within 30 seconds, no restart.
- Revoking a key → rejected within 30 seconds, no restart.

Two self-hosted providers are supported: **Infisical** and **OpenBao**. Both are open-source and run entirely on your infrastructure — no vendor cloud required.

## Choosing a secret manager

| | Infisical | OpenBao |
|---|---|---|
| **What it is** | Purpose-built secret management platform | Community fork of HashiCorp Vault |
| **UI** | Full web UI with project/environment structure | Vault-style web UI |
| **Secret format** | Key-value pairs in a project+environment | KV v2 engine at a configurable path |
| **Auth method** | Machine identity with Universal Auth | AppRole (role-id + secret-id) |
| **When to pick it** | You want a polished UI and team-level access controls | You already run Vault / want Vault compatibility |

## How the server uses secret managers

When `SECRET_MANAGER_TYPE` is set, the server instantiates either `InfisicalCredentialVerifier` or `OpenBaoCredentialVerifier`. Both share the same caching layer:

1. On the first inbound request after startup (or after the 30-second TTL expires), the verifier fetches the secret store.
2. The fetched store is kept in memory for 30 seconds. All requests within that window read from the cache — no network round-trip.
3. After 30 seconds, the next request triggers a background refresh. If the refresh fails (provider unreachable), the old cache is retained and an error is logged — the server keeps serving.

The credential format expected from the secret manager is identical to the static `.env` format:

```
API_KEYS=label:key,...
MQTT_CREDENTIALS=label:password,...
```

## Infisical

[Infisical](https://infisical.com) is a secrets platform with a web UI, RBAC, and audit logs. The `docker-compose.infisical.yml` overlay runs a self-hosted Infisical instance alongside the Mallard stack.

### Docker Compose

```bash
cd server/docker
# Copy and edit .env — also set the Infisical bootstrap variables below
cp .env.example .env

docker compose -f docker-compose.yml -f docker-compose.infisical.yml up -d
```

**Required `.env` additions:**

```bash
SECRET_MANAGER_TYPE=infisical
SECRET_MANAGER_URL=http://infisical:8080

# Machine identity token — create in the Infisical UI under
# Project > Machine Identities > Universal Auth
SECRET_MANAGER_TOKEN=your-machine-token

INFISICAL_PROJECT_ID=your-project-id
INFISICAL_ENV_SLUG=prod          # or "staging", "dev"

# Infisical itself needs a postgres database and redis:
INFISICAL_DB_CONNECTION_STRING=postgres://infisical:password@infisical-db:5432/infisical
INFISICAL_AUTH_SECRET=$(openssl rand -hex 16)
INFISICAL_ENCRYPTION_KEY=$(openssl rand -hex 16)
```

**Setting up the secrets in Infisical:**

1. Open the Infisical UI at `http://localhost:8888` (first boot takes ~30 s to initialise).
2. Create a project named `mallard`.
3. Add secrets to the `prod` environment:

   | Secret key | Example value |
   |---|---|
   | `API_KEYS` | `alice:key-abc123,bob:key-def456` |
   | `MQTT_CREDENTIALS` | `alice:mqtt-pass1` |

4. Create a Machine Identity with Universal Auth. Copy the client ID and secret.
5. Generate a machine token and paste it into `SECRET_MANAGER_TOKEN`.

### Kubernetes

The K8s overlay uses the Infisical Secrets Operator, which syncs secrets from Infisical into a Kubernetes Secret that the server reads as environment variables.

**Install the operator:**

```bash
helm repo add infisical-helm-charts https://dl.cloudsmith.io/public/infisical/helm-charts/helm/charts/
helm install infisical-operator infisical-helm-charts/secrets-operator \
  --namespace infisical-operator --create-namespace
```

**Bootstrap credentials secret** (create once, contains the Machine Identity credentials):

```bash
kubectl create secret generic infisical-universal-auth-credentials \
  --namespace mallard \
  --from-literal=clientId=YOUR_CLIENT_ID \
  --from-literal=clientSecret=YOUR_CLIENT_SECRET
```

**Apply the overlay:**

```bash
kubectl apply -k server/k8s/infisical/
```

The overlay creates an `InfisicalSecret` resource that tells the operator to watch your Infisical project and sync `API_KEYS`, `MQTT_CREDENTIALS`, and `INFLUX_TOKEN` into the `mallard-app-secrets` Kubernetes Secret. The server Deployment mounts that Secret as environment variables via `envFrom`.

**Verifying it works:**

```bash
# After a few seconds, the managed secret should be populated:
kubectl get secret mallard-app-secrets -n mallard -o yaml

# The server pod should reflect the new credentials within one sync interval (default 60s):
kubectl logs -n mallard deploy/mallard-server | grep "credential store refreshed"
```

## OpenBao

[OpenBao](https://openbao.org) is a community-maintained fork of HashiCorp Vault, API-compatible with Vault KV v2. Choose it if you already operate a Vault cluster or want a battle-tested secret engine.

### Docker Compose

The `docker-compose.openbao.yml` overlay starts OpenBao in dev mode (in-memory, no persistence — for production use a real OpenBao/Vault cluster) and an `openbao-init` one-shot container that seeds secrets from your `.env`.

```bash
cd server/docker
docker compose -f docker-compose.yml -f docker-compose.openbao.yml up -d
```

**Required `.env` additions:**

```bash
SECRET_MANAGER_TYPE=openbao
SECRET_MANAGER_URL=http://openbao:8200

# Root token (dev mode — change for production)
SECRET_MANAGER_TOKEN=root

# Optional: KV path to read credentials from
# Default is "secret/data/mallard/server"
# OPENBAO_SECRET_PATH=secret/data/mallard/server

# Optional: Vault namespace (Enterprise/HCP only; leave blank for community)
# OPENBAO_NAMESPACE=
```

The `openbao-init` container enables KV v2 and writes a secret at `secret/data/mallard/server` using the values from `API_KEYS` and `MQTT_CREDENTIALS` in your `.env`. After startup, manage secrets through the OpenBao UI at `http://localhost:8201` or with the `bao` CLI:

```bash
# List current credentials
bao kv get secret/mallard/server

# Add or rotate a key
bao kv patch secret/mallard/server api_keys="alice:new-key,bob:key-def456"
# The server picks up the change within 30 seconds — no restart needed
```

### Kubernetes

The K8s overlay uses the Vault Agent Injector (compatible with OpenBao) to write credentials to a file at `/vault/secrets/config` inside the server container. The server reads environment variables from that file on each credential refresh.

**Install OpenBao (HA with Raft):**

```bash
helm repo add openbao https://openbao.github.io/openbao-helm
helm install openbao openbao/openbao \
  --namespace openbao --create-namespace \
  --set server.ha.enabled=true \
  --set server.ha.raft.enabled=true
```

**Initialise and unseal** (first time only):

```bash
kubectl exec -n openbao openbao-0 -- bao operator init -key-shares=1 -key-threshold=1
# Save the unseal key and root token from the output!
kubectl exec -n openbao openbao-0 -- bao operator unseal <UNSEAL_KEY>
```

**Configure AppRole and seed secrets:**

```bash
# Port-forward to reach the API
kubectl port-forward -n openbao svc/openbao 8200:8200 &

export BAO_ADDR=http://localhost:8200
export BAO_TOKEN=<root-token>

# Enable KV v2
bao secrets enable -path=secret kv-v2

# Write credentials
bao kv put secret/mallard/server \
  api_keys="alice:key-abc123,bob:key-def456" \
  mqtt_credentials="alice:mqtt-pass1"

# Create policy
bao policy write mallard server/k8s/openbao/policy-mallard.hcl

# Enable AppRole and create the mallard role
bao auth enable approle
bao write auth/approle/role/mallard \
  token_policies=mallard \
  token_ttl=1h \
  secret_id_ttl=0

# Get role-id and secret-id
bao read auth/approle/role/mallard/role-id
bao write -f auth/approle/role/mallard/secret-id
```

**Apply the overlay:**

```bash
# Populate the secret-id into a Kubernetes Secret first
kubectl create secret generic openbao-approle-creds \
  --namespace mallard \
  --from-literal=role-id=<ROLE_ID> \
  --from-literal=secret-id=<SECRET_ID>

kubectl apply -k server/k8s/openbao/
```

The kustomize overlay patches the server Deployment with Vault Agent Injector annotations. The agent sidecar authenticates via AppRole and writes credentials to `/vault/secrets/config`.

## Credential rotation

Regardless of which provider you use, the rotation flow is the same:

1. Update the secret in Infisical or OpenBao.
2. Wait up to 30 seconds for the server's cache to expire.
3. The next inbound request fetches the new credential store.
4. Old keys are rejected; new keys are accepted.

No server restart required.

For **static credentials** (no secret manager), rotation on Kubernetes is handled by Stakater Reloader: update the `mallard-server-secrets` Secret and Reloader triggers a zero-downtime rolling restart.
