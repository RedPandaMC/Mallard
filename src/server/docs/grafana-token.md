# A read-only InfluxDB token for Grafana

Grafana only ever reads from InfluxDB, so the token in its provisioned
datasource should be a **read-only token scoped to the metrics bucket** — not
`INFLUX_TOKEN`, the all-access admin token created at first boot. With a
scoped token, a compromised Grafana (or a leaked datasource export) cannot
write to, delete from, or administer the metrics store.

Both deployments now require a separate value:

- **Docker Compose** — `GRAFANA_INFLUX_TOKEN` in `.env`
  (`docker/docker-compose.yml` injects it as the datasource token).
- **Kubernetes** — `INFLUX_TOKEN` inside the `grafana-secrets` Secret
  (`k8s/secrets.yaml.example`), which is separate from the server's
  `mallard-server-secrets`.

## Creating the token

InfluxDB must be initialized first (first stack boot does this), then:

### Docker Compose

```bash
docker compose exec influxdb influx auth create \
  --org mallard \
  --read-bucket metrics \
  --description "grafana read-only"
```

Copy the token from the output into `.env` as `GRAFANA_INFLUX_TOKEN` and
restart Grafana:

```bash
docker compose up -d grafana
```

### Kubernetes

```bash
kubectl -n mallard exec statefulset/influxdb -- influx auth create \
  --org mallard \
  --read-bucket metrics \
  --description "grafana read-only"
```

Put the token in the `grafana-secrets` Secret and restart the Grafana
deployment:

```bash
kubectl -n mallard rollout restart deployment/grafana
```

If your org or bucket names differ from the defaults (`mallard` / `metrics`),
substitute them in the commands above.

## Rotating

Create a new token, update the secret, restart Grafana, then delete the old
token with `influx auth delete --id <id>` (`influx auth list` shows ids).
