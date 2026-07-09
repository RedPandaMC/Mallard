# OpenBao Secret Management for Mallard

OpenBao (an open-source Vault fork) provides dynamic credential management with short-lived tokens and AppRole auth.

The server talks to OpenBao directly — the same `OpenBaoCredentialVerifier` live-fetch code path Docker Compose uses, just pointed at an in-cluster OpenBao instead of a container on the same network. No agent sidecar or injector webhook is needed.

> **Warning — sealed after every restart.** OpenBao starts *sealed*: after any pod restart (node reboot, eviction, upgrade) someone must run the unseal commands below with 3 of the 5 key shares before the server can fetch credentials again. Until then `/health` stays green but every ingest fails 503 once the 30-second cache goes cold. If nobody on the team will notice and unseal promptly, stay on the default static backend — a Kubernetes Secret has no such failure mode.

## Install OpenBao (self-hosted, HA + Raft)

```bash
helm repo add openbao https://openbao.github.io/openbao-helm
helm install openbao openbao/openbao \
  --namespace openbao --create-namespace \
  --set "server.ha.enabled=true" \
  --set "server.ha.raft.enabled=true"
```

## Initialize and unseal

```bash
# Initialize (run once)
kubectl exec -n openbao openbao-0 -- bao operator init \
  -key-shares=5 -key-threshold=3 > openbao-init.txt

# Unseal (requires 3 of the 5 unseal keys printed above)
for i in 1 2 3; do
  kubectl exec -n openbao openbao-0 -- bao operator unseal <unseal-key-$i>
done

# Set root token for subsequent commands
export BAO_TOKEN=<root-token-from-init-output>
export BAO_ADDR=http://openbao.openbao.svc.cluster.local:8200
```

## Configure AppRole, seed secrets, and get a client token

```bash
# Run from inside the cluster (or with kubectl port-forward openbao 8200:8200)
chmod +x server/k8s/openbao/approle-setup.sh
./server/k8s/openbao/approle-setup.sh

# Seed Mallard secrets
#   api_keys      "label:secret" pairs — the label becomes the InfluxDB source tag
#   mqtt_password single shared broker password (all MQTT ingest is source='mqtt')
#   cert_labels   optional "label:cn" pairs mapping mTLS cert CNs to source labels
#   jwt_*         optional JWT bearer auth (any subset; presence of key material enables it):
#                   jwt_hmac_secret  HS* shared secret   OR
#                   jwt_public_key   PEM for RS*/ES*/PS*  OR  jwt_jwks_url  JWKS endpoint
#                   jwt_algorithms   CSV (default HS256, or RS256/ES256 when asymmetric)
#                   jwt_issuer/jwt_audience  enforced when set
#                   jwt_label_claim  claim used for the source label (default "sub")
#                   jwt_labels       "label:claimValue" pairs (unmapped → claim value)
bao kv put secret/mallard/server \
  api_keys="team-alpha:key-abc123,team-beta:key-def456" \
  mqtt_password="shared-broker-password" \
  cert_labels="ci:build-agent-01" \
  jwt_jwks_url="https://idp.example.com/.well-known/jwks.json" \
  jwt_issuer="https://idp.example.com/" \
  jwt_labels="ci:ci-bot" \
  influx_token="your-influx-token"
```

> All `jwt_*` keys live in the same `secret/data/mallard/*` path, which the
> `policy-mallard.hcl` policy already grants `read` on — no policy change needed
> to add JWT auth.

`approle-setup.sh` prints a client token at the end. Store it in the `mallard-openbao-secrets` Secret (see `secrets.yaml.example`):

```bash
kubectl create secret generic mallard-openbao-secrets \
  --from-literal=SECRET_MANAGER_TOKEN=<client-token-from-script> \
  -n mallard
```

## Apply the overlay

```bash
kubectl apply -k server/k8s/openbao/
```

This patches the `mallard-server` Deployment to read `SECRET_MANAGER_TOKEN` from `mallard-openbao-secrets` and sets `SECRET_MANAGER_TYPE=openbao` / `SECRET_MANAGER_URL` directly.

## Credential rotation

Update credentials in OpenBao:

```bash
bao kv put secret/mallard/server \
  api_keys="team-alpha:new-key,..." \
  mqtt_password="new-broker-password"
```

The server's `OpenBaoCredentialVerifier` re-fetches the store within 30 seconds. No pod restart needed.

To immediately revoke a token, use `bao token revoke <token>`. The next request will fail auth.

The client token itself expires after `token_max_ttl` (2160h / 90 days by default, set in `approle-setup.sh`) regardless of use — re-run the script and update the Secret before then.

## Environment variables

| Variable | Set by | Description |
|---|---|---|
| `SECRET_MANAGER_TYPE` | `patch-server-env.yaml` | `openbao` |
| `SECRET_MANAGER_URL` | `patch-server-env.yaml` | OpenBao address (e.g. `http://openbao.openbao.svc.cluster.local:8200`) |
| `SECRET_MANAGER_TOKEN` | `mallard-openbao-secrets` Secret | Client token from `approle-setup.sh` |
| `SECRET_MANAGER_CA_CERT_PATH` | not set by default | Path to CA cert for TLS verification (optional) |
| `OPENBAO_SECRET_PATH` | server default | KV path (default: `secret/data/mallard/server`) |
| `OPENBAO_NAMESPACE` | not set by default | Namespace header (leave empty for community edition) |
