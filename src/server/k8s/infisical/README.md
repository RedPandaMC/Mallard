# Infisical Secret Management for Mallard

The server talks to Infisical directly — the same `InfisicalCredentialVerifier` live-fetch code path Docker Compose uses, just pointed at an in-cluster Infisical instance instead of a container on the same network. No Infisical Secrets Operator or extra webhook is needed.

## Install Infisical (self-hosted, in-cluster)

```bash
helm repo add infisical-helm-charts https://dl.cloudsmith.io/public/infisical/helm-charts/helm/charts/
helm install infisical infisical-helm-charts/infisical \
  --namespace infisical --create-namespace \
  --set postgresql.enabled=true \
  --set redis.enabled=true
```

## Configure

1. Open the Infisical UI and create a project named `mallard`. Note its project ID.
2. Add secrets to the `prod` environment: `API_KEYS`, `MQTT_PASSWORD`, `CERT_LABELS`, `INFLUX_TOKEN`, etc. (see the credential format below).
3. Under Organization → Machine Identities, create a service token (or machine identity token) scoped to read access on the `mallard` project's `prod` environment. This is a plain bearer token, not a Universal Auth clientId/clientSecret pair.

## Apply the overlay

```bash
# Store the machine token and project ID
kubectl create secret generic mallard-infisical-secrets \
  --from-literal=SECRET_MANAGER_TOKEN=<machine-token> \
  --from-literal=INFISICAL_PROJECT_ID=<project-id> \
  -n mallard

# Apply the Kustomize overlay (sets SECRET_MANAGER_TYPE=infisical and wires the secret in)
kubectl apply -k server/k8s/infisical/
```

## Credential format in Infisical

Labels drive the `source` tag in InfluxDB so analytics can filter by team/person:

| Secret key | Example value | Notes |
|---|---|---|
| `API_KEYS` | `team-alpha:key-abc123,team-beta:key-def456` | `label:secret` pairs; Bearer tokens verify against the same store |
| `MQTT_PASSWORD` | `shared-broker-password` | single shared password; all MQTT ingest is tagged `source='mqtt'` |
| `CERT_LABELS` | `ci:build-agent-01` | optional `label:cn` pairs for mTLS certs; unmapped CNs fall back to the CN |
| `INFLUX_TOKEN` | `your-influx-token` | |

## Credential rotation

Revoke or update credentials directly in the Infisical UI. The server's `InfisicalCredentialVerifier` re-fetches the store on its TTL cycle (30s by default), no pod restart needed.

If the machine token itself needs rotating, update the `mallard-infisical-secrets` Secret and restart the pods (or apply with Stakater Reloader installed, which the base Deployment is already annotated for).

## Environment variables

| Variable | Set by | Description |
|---|---|---|
| `SECRET_MANAGER_TYPE` | `patch-server-envfrom.yaml` | `infisical` |
| `SECRET_MANAGER_URL` | `patch-server-envfrom.yaml` | In-cluster Infisical API address |
| `SECRET_MANAGER_TOKEN` | `mallard-infisical-secrets` Secret | Machine/service token from the Infisical UI |
| `INFISICAL_PROJECT_ID` | `mallard-infisical-secrets` Secret | Infisical project ID |
| `INFISICAL_ENV_SLUG` | `patch-server-envfrom.yaml` | `prod` |
