# OpenBao Secret Management for Mallard

OpenBao (an open-source Vault fork) provides dynamic credential management with short-lived tokens and AppRole auth.

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

## Configure AppRole and seed secrets

```bash
# Run from inside the cluster (or with kubectl port-forward openbao 8200:8200)
chmod +x server/k8s/openbao/approle-setup.sh
./server/k8s/openbao/approle-setup.sh

# Seed Mallard secrets
bao kv put secret/mallard/server \
  api_keys="team-alpha:key-abc123,team-beta:key-def456" \
  mqtt_credentials="alice:mqtt-pass1,ci-pipeline:mqtt-pass2" \
  influx_token="your-influx-token"
```

## Install the OpenBao Agent Injector

The agent injector runs as a MutatingWebhook and injects a sidecar that writes secrets to `/vault/secrets/config`.

```bash
helm upgrade openbao openbao/openbao \
  --namespace openbao \
  --set "injector.enabled=true"
```

## Apply the overlay

```bash
kubectl apply -k server/k8s/openbao/
```

This patches the `mallard-server` Deployment with agent-inject annotations.  On pod startup, the agent sidecar authenticates to OpenBao using the mounted AppRole credentials, fetches `secret/mallard/server`, and writes the rendered template to `/vault/secrets/config`.  The server container sources that file at startup.

## Credential rotation

Update credentials in OpenBao:

```bash
bao kv put secret/mallard/server \
  api_keys="team-alpha:new-key,..." \
  mqtt_credentials="alice:new-pass,..."
```

The server's `OpenBaoCredentialVerifier` re-fetches the store within 30 seconds (configurable via `SECRET_MANAGER_TTL`).  No pod restart needed.

To immediately revoke a token, use `bao token revoke <token>`. The next request will fail auth.

## Environment variables

| Variable | Description |
|---|---|
| `SECRET_MANAGER_TYPE` | Set to `openbao` |
| `SECRET_MANAGER_URL` | OpenBao address (e.g. `http://openbao.openbao.svc.cluster.local:8200`) |
| `SECRET_MANAGER_TOKEN` | AppRole token (obtained after login) |
| `SECRET_MANAGER_CA_CERT_PATH` | Path to CA cert for TLS verification (optional) |
| `OPENBAO_SECRET_PATH` | KV path (default: `secret/data/mallard/server`) |
| `OPENBAO_NAMESPACE` | Namespace header (leave empty for community edition) |
