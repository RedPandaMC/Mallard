# Operations Guide

## Credential rotation

### Static credentials (environment variables)

**Docker Compose:**

1. Update `.env` with new `API_KEYS` or `MQTT_CREDENTIALS` values.
2. `docker compose restart server`

**Kubernetes (Stakater Reloader):**

1. Update the `mallard-server-secrets` Secret:
   ```bash
   kubectl patch secret mallard-server-secrets -n mallard \
     --type=merge -p '{"stringData":{"API_KEYS":"team-alpha:new-key,team-beta:old-key"}}'
   ```
2. Reloader detects the change and triggers a rolling restart automatically.
   - HPA min=2 + PDB minAvailable=1 ensure zero downtime during the restart.

### Remote credentials (Infisical / OpenBao)

Update the credential in the secret manager UI or CLI. The `RemoteCredentialVerifier` re-fetches within 30 seconds — no restart needed.

To immediately block access: remove the credential from the secret manager. The next cache refresh will exclude it.

## Scaling

The `mallard-server` Deployment is managed by an HPA:
- Scales on CPU and memory usage.
- Min 2 replicas, max configurable.
- PDB ensures at least 1 replica is always available during rolling updates.

```bash
kubectl get hpa -n mallard
kubectl describe hpa mallard-server-hpa -n mallard
```

## InfluxDB backup

```bash
# Docker Compose: run influx CLI inside the influxdb container
docker compose exec influxdb influx backup /tmp/backup --token $INFLUX_TOKEN
docker compose cp influxdb:/tmp/backup ./backup-$(date +%Y%m%d)

# Kubernetes: exec into the pod
kubectl exec -n mallard deploy/influxdb -- \
  influx backup /tmp/backup --token $INFLUX_TOKEN
kubectl cp mallard/<influxdb-pod>:/tmp/backup ./backup-$(date +%Y%m%d)
```

## Health check

```bash
curl https://mallard.example.com/health
# → {"status":"ok"}
```

## Log levels

Set `LOG_LEVEL=DEBUG` in the environment to see per-request auth decisions and InfluxDB write confirmations. Reset to `INFO` for production.

## Monitoring

Import the provided Grafana dashboards (in `server/k8s/grafana/`) to track:
- Ingest request rate and error rate by `source`
- MQTT connection count
- InfluxDB write latency
- Pod CPU/memory (if kube-state-metrics is available)
