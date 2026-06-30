# Infisical Secret Management for Mallard

Self-hosted Infisical syncs secrets into a Kubernetes `Secret`, keeping the server pods up to date without restarts.

## Install Infisical (self-hosted, in-cluster)

```bash
helm repo add infisical-helm-charts https://dl.cloudsmith.io/public/infisical/helm-charts/helm/charts/
helm install infisical-operator infisical-helm-charts/secrets-operator \
  --namespace infisical-operator --create-namespace
helm install infisical infisical-helm-charts/infisical \
  --namespace infisical --create-namespace \
  --set postgresql.enabled=true \
  --set redis.enabled=true
```

## Configure

1. Open the Infisical UI and create a project named `mallard`.
2. Add secrets to the `prod` environment: `API_KEYS`, `MQTT_CREDENTIALS`, `INFLUX_TOKEN`, etc.
3. Create a Machine Identity (Universal Auth) and note its `clientId` and `clientSecret`.

## Apply the overlay

```bash
# Fill in credentials
kubectl edit secret infisical-universal-auth-credentials -n mallard
# OR patch directly:
kubectl create secret generic infisical-universal-auth-credentials \
  --from-literal=clientId=<id> --from-literal=clientSecret=<secret> \
  -n mallard

# Apply the Kustomize overlay (adds mallard-app-secrets envFrom to the Deployment)
kubectl apply -k server/k8s/infisical/
```

The Infisical Operator will:
1. Authenticate to the in-cluster Infisical instance using Universal Auth.
2. Sync all secrets in `mallard/prod/` to the `mallard-app-secrets` Kubernetes Secret.
3. Re-sync every 60 seconds.

## Credential format in Infisical

Use `label:value` format so each identity gets a `source` tag in InfluxDB:

| Secret key | Example value |
|---|---|
| `API_KEYS` | `team-alpha:key-abc123,team-beta:key-def456` |
| `MQTT_CREDENTIALS` | `alice:mqtt-pass1,ci-pipeline:mqtt-pass2` |
| `INFLUX_TOKEN` | `your-influx-token` |

## Credential rotation

Revoke or update credentials directly in the Infisical UI.  The server's
`RemoteCredentialVerifier` re-fetches the store on its TTL cycle (30 s by default)
— no pod restart needed.  Set `SECRET_MANAGER_TYPE=infisical` in the Deployment's
environment to activate the Infisical verifier path.
