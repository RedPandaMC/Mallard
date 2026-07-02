# Secret Management

Mallard's server requires a live secret manager. There is no supported way to run it on static `.env`/Kubernetes-Secret credentials alone: `Settings.secret_manager_type` only accepts `"infisical"` or `"openbao"`, and the server refuses to start without one fully configured.

The server fetches live credentials from whichever manager you pick, with a 30-second in-memory cache, so that:
- Adding a key → visible within 30 seconds, no restart.
- Revoking a key → rejected within 30 seconds, no restart.

Two self-hosted providers are supported: **Infisical** and **OpenBao**. Both are open-source and run entirely on your infrastructure, with no vendor cloud required. Pick one before you deploy.

## Infisical vs. OpenBao

| | Infisical | OpenBao |
|---|---|---|
| **What it is** | Purpose-built secrets, certificates, and access-management platform | Community fork of HashiCorp Vault |
| **UI** | Full web UI: projects, environments, audit log, RBAC | Vault-style web UI, more ops-tool than product |
| **Secret format** | Key-value pairs in a project + environment | KV v2 engine at a configurable path |
| **Auth (used by Mallard)** | Machine/service token, sent as a Bearer token | A Vault client token, sent as `X-Vault-Token` |
| **Ecosystem / maturity** | Newer project, growing fast, more integrations out of the box | Direct continuation of Vault's much larger, longer-established ecosystem |
| **Governance** | Company-backed (Infisical, Inc.) | Community-run under the Linux Foundation / OpenSSF |
| **Self-hosting complexity** | Needs Postgres + Redis alongside it | Single binary; dev mode needs nothing else, HA needs Raft storage |
| **Best fit** | You want a polished UI, team-level access controls, and don't mind running a small Postgres+Redis stack | You already run Vault, want Vault API compatibility, or want the leaner single-binary footprint |

### Licensing

This matters more than it looks, since one of the two has a boundary you can hit without noticing.

- **Infisical**: the self-hosted core (everything outside `backend/src/ee/`) is [MIT-licensed](https://github.com/Infisical/infisical/blob/main/LICENSE). Dynamic secrets, SCIM, LDAP, approval workflows, KMIP, and HSM support live behind a separate **Infisical Enterprise License**, which requires a paid license key (it phones home to Infisical's license server, or takes an offline key for air-gapped setups) to unlock at runtime. Mallard only needs the MIT-licensed core (static key-value secrets), so this boundary doesn't affect a typical Mallard deployment, but it's worth knowing about before you reach for a feature that turns out to be gated.
- **OpenBao**: single-licensed under [MPL-2.0](https://github.com/openbao/openbao/blob/main/LICENSE), governed by the Linux Foundation and the Open Source Security Foundation (OpenSSF). There is no separate enterprise tier or license key gating any feature.

## How the server uses secret managers

The server instantiates either `InfisicalCredentialVerifier` or `OpenBaoCredentialVerifier` based on `SECRET_MANAGER_TYPE`. Both share the same caching layer:

1. On the first inbound request after startup (or after the 30-second TTL expires), the verifier fetches the secret store.
2. The fetched store is kept in memory for 30 seconds. All requests within that window read from the cache, with no network round-trip.
3. After 30 seconds, the next request triggers a background refresh. If the refresh fails (provider unreachable), the old cache is retained and an error is logged; the server keeps serving.

The credential format expected from the secret manager is the same `label:secret` format used everywhere else in Mallard:

```
API_KEYS=label:key,...
MQTT_CREDENTIALS=label:password,...
```

## Infisical

[Infisical](https://infisical.com) is a secrets platform with a web UI, RBAC, and audit logs. The `docker-compose.infisical.yml` overlay runs a self-hosted Infisical instance alongside the Mallard stack.

### Docker Compose

```bash
cd server/docker
cp .env.example .env
# Edit .env: fill in the Infisical block, leave the OpenBao block commented out

docker compose -f docker-compose.yml -f docker-compose.infisical.yml up -d
```

**Setting up the secrets in Infisical:**

1. Open the Infisical UI at `http://localhost:8888` (first boot takes ~30s to initialise).
2. Create a project named `mallard`.
3. Add secrets to the `prod` environment:

   | Secret key | Example value |
   |---|---|
   | `API_KEYS` | `alice:key-abc123,bob:key-def456` |
   | `MQTT_CREDENTIALS` | `alice:mqtt-pass1` |

4. Under Machine Identities, create a service/machine token scoped to read access on this project. Paste it into `INFISICAL_MACHINE_TOKEN` in `.env`.

### Kubernetes

The server talks to Infisical directly, the same live-fetch code path as Docker Compose, pointed at an in-cluster Infisical instance. No Infisical Secrets Operator or extra webhook is installed.

```bash
helm repo add infisical-helm-charts https://dl.cloudsmith.io/public/infisical/helm-charts/helm/charts/
helm install infisical infisical-helm-charts/infisical \
  --namespace infisical --create-namespace \
  --set postgresql.enabled=true \
  --set redis.enabled=true
```

Create a project and a machine/service token in the Infisical UI as above, then:

```bash
kubectl create secret generic mallard-infisical-secrets \
  --from-literal=SECRET_MANAGER_TOKEN=<machine-token> \
  --from-literal=INFISICAL_PROJECT_ID=<project-id> \
  -n mallard

kubectl apply -k server/k8s/infisical/
```

The overlay sets `SECRET_MANAGER_TYPE=infisical` and `SECRET_MANAGER_URL` on the server Deployment and wires in the Secret above. See `server/k8s/infisical/README.md` for the full walkthrough.

## OpenBao

[OpenBao](https://openbao.org) is a community-maintained fork of HashiCorp Vault, API-compatible with Vault KV v2. Choose it if you already operate a Vault cluster or want a battle-tested secret engine.

### Docker Compose

The `docker-compose.openbao.yml` overlay starts OpenBao in dev mode (in-memory, no persistence; for production use a real OpenBao/Vault cluster) and an `openbao-init` one-shot container that seeds secrets from your `.env`.

```bash
cd server/docker
cp .env.example .env
# Edit .env: fill in the OpenBao block, leave the Infisical block commented out

docker compose -f docker-compose.yml -f docker-compose.openbao.yml up -d
```

The `openbao-init` container enables KV v2 and writes a secret at `secret/data/mallard/server` using the values from `API_KEYS` and `MQTT_CREDENTIALS` in your `.env`. After startup, manage secrets through the OpenBao UI at `http://localhost:8200` or with the `bao` CLI:

```bash
# List current credentials
bao kv get secret/mallard/server

# Add or rotate a key
bao kv patch secret/mallard/server api_keys="alice:new-key,bob:key-def456"
# The server picks up the change within 30 seconds, no restart needed
```

### Kubernetes

The server talks to OpenBao directly, the same live-fetch code path as Docker Compose, pointed at an in-cluster OpenBao instance. No Vault Agent Injector or sidecar is installed.

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
  mqtt_credentials="alice:mqtt-pass1"
```

`approle-setup.sh` prints a client token at the end:

```bash
kubectl create secret generic mallard-openbao-secrets \
  --from-literal=SECRET_MANAGER_TOKEN=<client-token> \
  -n mallard

kubectl apply -k server/k8s/openbao/
```

The overlay sets `SECRET_MANAGER_TYPE=openbao` and `SECRET_MANAGER_URL` on the server Deployment and wires in the Secret above. See `server/k8s/openbao/install.md` for the full walkthrough, including client token expiry and renewal.

## Credential rotation

Regardless of which provider you use, rotating an actual API key or MQTT password is the same:

1. Update the secret in Infisical or OpenBao.
2. Wait up to 30 seconds for the server's cache to expire.
3. The next inbound request fetches the new credential store.
4. Old keys are rejected; new keys are accepted.

No server restart required. Rotating the secret manager's own access token (`SECRET_MANAGER_TOKEN`) is different: that's a Secret/`.env` value the server reads once at startup and caches for the process lifetime, so it needs a restart. On Kubernetes, Stakater Reloader handles this automatically when you update the `mallard-infisical-secrets` / `mallard-openbao-secrets` Secret.

## Operational visibility

Neither Infisical's nor OpenBao's own UI knows anything about Mallard's ingest traffic. For that, use what the stack already ships instead of a separate tool:

- `GET /health` reports `min_known_schema_version`/`max_known_schema_version` so you can spot extension version skew across a fleet at a glance.
- The Grafana dashboards break down ingest volume by the `connector` and `schema_version` InfluxDB tags, so you can see per-connector traffic and version skew visually without leaving the dashboard you already have open.
- Credential status and edits stay in Infisical's or OpenBao's own UI — that's what they're for, and duplicating it in a third tool would just be another thing to keep in sync.
