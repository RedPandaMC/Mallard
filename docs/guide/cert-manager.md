# cert-manager

cert-manager is a Kubernetes operator that manages the **lifecycle of TLS certificates**: it provisions them (from Let's Encrypt, an internal CA, or a self-signed issuer) and renews them automatically before they expire. Let's Encrypt certificates expire every 90 days; cert-manager handles that renewal silently with no operator involvement.

> **cert-manager handles TLS certificates. Infisical and OpenBao handle application secrets (API keys, passwords, tokens).** They are completely different concerns and you will typically use all three together: cert-manager for HTTPS + mTLS, and Infisical or OpenBao for credentials. See [Secret Management](/guide/secret-management).

## What cert-manager provides for Mallard

| Concern | Who handles it |
|---|---|
| HTTPS on the ingress (Let's Encrypt or self-signed) | cert-manager |
| mTLS client certificates for the VS Code extension | cert-manager |
| API keys (`API_KEYS` env var) | Static `.env` or Infisical/OpenBao |
| MQTT passwords (`MQTT_CREDENTIALS`) | Static `.env` or Infisical/OpenBao |
| InfluxDB token (`INFLUX_TOKEN`) | Static `.env` or Infisical/OpenBao |

## Installing cert-manager

```bash
helm repo add jetstack https://charts.jetstack.io --force-update
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set crds.enabled=true
```

Wait for the pods to be ready:

```bash
kubectl wait --namespace cert-manager \
  --for=condition=Ready pod \
  --selector=app.kubernetes.io/instance=cert-manager \
  --timeout=90s
```

## Applying the ClusterIssuers

::: warning Before you apply
The ClusterIssuer files contain `admin@example.com` as a placeholder. **Replace it with your real email address** before applying — Let's Encrypt uses this to send expiry notifications and will reject the application otherwise.

```bash
# Replace the placeholder with your actual email
sed -i "s/admin@example.com/you@example.com/" server/k8s/cert-manager/cluster-issuer-prod.yaml
sed -i "s/admin@example.com/you@example.com/" server/k8s/cert-manager/cluster-issuer-staging.yaml
```
:::

```bash
kubectl apply -f server/k8s/cert-manager/
```

This creates four ClusterIssuers and the reusable client certificate template:

| Resource | Purpose |
|---|---|
| `letsencrypt-staging` | ACME staging (no rate limits — use this first to verify your setup) |
| `letsencrypt-prod` | ACME production (trusted by browsers — used by `ingress.yaml`) |
| `selfsigned` | Self-signed (for air-gapped clusters or local dev) |
| `mallard-ca` | Internal CA for issuing mTLS client certificates |
| `client-cert-template.yaml` | Example Certificate resource for one team member |

## Choosing an issuer

The ingress uses `letsencrypt-prod` by default. Switch by editing the annotation in `server/k8s/ingress.yaml`:

```yaml
cert-manager.io/cluster-issuer: letsencrypt-prod   # change to staging or selfsigned
```

**When to use each issuer:**

- `letsencrypt-staging` — use this first. Certificates are not trusted by browsers but there are no rate limits. Verify that ACME DNS/HTTP challenge works before switching to prod.
- `letsencrypt-prod` — for production. Rate limited (5 failed validations per hostname per hour). Requires your domain to be publicly reachable via HTTP.
- `selfsigned` — for air-gapped clusters or local development where you control all clients. Clients must trust the cert manually.
- `mallard-ca` — only for issuing mTLS client certificates (see below). Do not use this for the ingress.

## Checking certificate status

```bash
# Is the Let's Encrypt certificate ready?
kubectl get certificate mallard-tls -n mallard

# If not ready, check the CertificateRequest and Order for errors:
kubectl describe certificaterequest -n mallard
kubectl describe order -n mallard
```

Common failure causes:
- HTTP-01 challenge: the ingress must be publicly reachable on port 80 before the cert is issued.
- DNS-01 challenge: requires a DNS provider webhook (not configured here by default).
- Rate limits: switch to `letsencrypt-staging` to test without burning rate limit quota.

## mTLS client certificates {#client-certificates}

mTLS lets the VS Code extension authenticate with a certificate instead of an API key or password. The certificate's **Common Name (CN)** becomes the `source` tag on every InfluxDB data point — no separate credential entry is needed in `API_KEYS`.

The nginx ingress is already annotated in `server/k8s/ingress.yaml` to:
1. Accept (but not require) a client certificate.
2. Verify it against the `mallard-ca` ClusterIssuer's CA.
3. Forward the client's CN as the `SSL_CLIENT_S_DN_CN` header to the server.

The server reads that header and uses it as the `source` tag in preference to the API key label.

### The internal CA

The `mallard-ca` ClusterIssuer signs client certificates using a CA key pair you generate once:

```bash
# Generate a self-signed CA (do this once; keep the key secure)
openssl genrsa -out mallard-ca.key 4096
openssl req -x509 -new -nodes \
  -key mallard-ca.key \
  -sha256 -days 3650 \
  -subj "/CN=Mallard Internal CA/O=YourOrg" \
  -out mallard-ca.crt

# Store it as a Kubernetes Secret
kubectl create secret tls mallard-ca-key-pair \
  --namespace mallard \
  --cert=mallard-ca.crt \
  --key=mallard-ca.key
```

### Issuing a client certificate

Edit `server/k8s/cert-manager/client-cert-template.yaml` to name the team member:

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: mallard-client-alice    # one per team member or machine
  namespace: mallard
spec:
  secretName: mallard-client-alice-tls
  issuerRef:
    name: mallard-ca
    kind: ClusterIssuer
  commonName: alice             # becomes the source= tag in InfluxDB
  usages:
    - client auth
  duration: 8760h               # 1 year
  renewBefore: 720h             # renew 30 days before expiry
```

```bash
kubectl apply -f server/k8s/cert-manager/client-cert-template.yaml
```

### Distributing the certificate

Export the cert and key from the Kubernetes Secret and send them to the team member securely:

```bash
kubectl get secret mallard-client-alice-tls -n mallard \
  -o jsonpath='{.data.tls\.crt}' | base64 -d > alice.crt

kubectl get secret mallard-client-alice-tls -n mallard \
  -o jsonpath='{.data.tls\.key}' | base64 -d > alice.key

# Also distribute the CA cert so the extension can verify the server
kubectl get secret mallard-ca-key-pair -n mallard \
  -o jsonpath='{.data.tls\.crt}' | base64 -d > mallard-ca.crt
```

### Configuring the extension

```json
"mallard.server.url": "https://mallard.your-org.com",
"mallard.export.transport": "webhook",
"mallard.webhook.auth": "certificate",
"mallard.shared.certificate.file": "/home/alice/.certs/alice.crt",
"mallard.shared.certificate.keyFile": "/home/alice/.certs/alice.key",
"mallard.shared.certificate.caFile": "/home/alice/.certs/mallard-ca.crt"
```

All InfluxDB data points from Alice's machine will have `source=alice` with no API key needed.

### Revoking a certificate

cert-manager auto-renews certificates but does not implement OCSP or CRL by default. To revoke a certificate, delete the cert-manager Certificate resource and the corresponding Kubernetes Secret:

```bash
kubectl delete certificate mallard-client-alice -n mallard
kubectl delete secret mallard-client-alice-tls -n mallard
```

Because the ingress checks the client certificate against the CA and the CA key pair is still in `mallard-ca-key-pair`, you must also regenerate the CA if the key is compromised. For a compromised key (not just an expired cert), issue a new CA, re-issue all client certs, and update the ingress `auth-tls-secret` annotation.

## cert-manager with Docker Compose

cert-manager is Kubernetes-only. For Docker Compose, Caddy handles HTTPS automatically:

- **Public domain**: set `SERVER_DOMAIN` and `ACME_EMAIL` in `.env`. Caddy uses the ACME HTTP-01 challenge.
- **Local dev**: Caddy issues a self-signed cert. Browsers will warn; you can trust it manually or add it to your system trust store.
- **mTLS on Docker Compose**: supported via the `client_auth` block in the Caddyfile — see `server/docker/Caddyfile` for configuration details.
