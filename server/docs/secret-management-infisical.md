# Secret Management — Infisical (self-hosted)

Infisical is an open-source secret manager. When enabled, Mallard's `InfisicalCredentialVerifier` fetches credentials from Infisical on every request (with a 30-second TTL cache) instead of reading from environment variables.

## Docker Compose

```bash
# Add required env vars to .env:
SECRET_MANAGER_TYPE=infisical
SECRET_MANAGER_URL=http://localhost:8888
INFISICAL_DB_PASSWORD=strong-password
INFISICAL_AUTH_SECRET=32-char-random-string
INFISICAL_ENCRYPTION_KEY=32-char-random-string
INFISICAL_MACHINE_TOKEN=   # fill in after UI setup below
INFISICAL_PROJECT_ID=      # fill in after UI setup below

# Start the full stack (Infisical + Mallard):
docker compose -f docker-compose.yml -f docker-compose.infisical.yml up -d
```

Open `http://localhost:8888`, create an account, then:
1. Create a project named `mallard`.
2. Add secrets to the `prod` environment: `API_KEYS`, `MQTT_CREDENTIALS`, `INFLUX_TOKEN`.
3. Create a Machine Identity (Universal Auth) and copy its token.
4. Set `INFISICAL_MACHINE_TOKEN` and `INFISICAL_PROJECT_ID` in `.env`.
5. Restart: `docker compose -f docker-compose.yml -f docker-compose.infisical.yml up -d server`.

## Kubernetes

See `server/k8s/infisical/README.md` for the K8s Operator-based setup.

## Credential format

Secrets in Infisical must follow the `label:value` format so Mallard can tag InfluxDB points:

| Infisical secret key | Example value |
|---|---|
| `API_KEYS` | `team-alpha:key-abc123,team-beta:key-def456` |
| `MQTT_CREDENTIALS` | `alice:mqtt-pass1,ci-pipeline:mqtt-pass2` |

Bare values (no label) are accepted but get the source tag `unknown`.

## Credential rotation

Update the secret value in the Infisical UI. Within 30 seconds (the default TTL), the verifier re-fetches the store. No server restart or pod rolling update required.

To immediately block a credential, remove its entry from `API_KEYS` or `MQTT_CREDENTIALS` — the next fetch will not include it and the key returns 401.

## Environment variables

| Variable | Description |
|---|---|
| `SECRET_MANAGER_TYPE` | `infisical` |
| `SECRET_MANAGER_URL` | Infisical base URL (e.g. `http://infisical:8080`) |
| `SECRET_MANAGER_TOKEN` | Machine identity token |
| `SECRET_MANAGER_CA_CERT_PATH` | Path to CA cert for TLS (leave empty to use system CAs) |
| `INFISICAL_PROJECT_ID` | Project ID (UUID from Infisical UI) |
| `INFISICAL_ENV_SLUG` | Environment slug (default: `prod`) |
