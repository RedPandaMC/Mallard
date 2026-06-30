# cert-manager for Mallard

## Install cert-manager

```bash
helm repo add jetstack https://charts.jetstack.io --force-update
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true
```

## Apply issuers

```bash
kubectl apply -f server/k8s/cert-manager/
```

This creates four ClusterIssuers:

| Issuer | Use case |
|---|---|
| `letsencrypt-staging` | CI / testing — no rate limits |
| `letsencrypt-prod` | Production — matches `ingress.yaml` annotation |
| `selfsigned` | Air-gapped / dev clusters |
| `mallard-ca` | Internal CA for mTLS client certificates |

## Switch issuer

Edit the `cert-manager.io/cluster-issuer` annotation in `server/k8s/ingress.yaml`:

```yaml
cert-manager.io/cluster-issuer: letsencrypt-prod   # or letsencrypt-staging, selfsigned
```

## mTLS client certificates

### Create the internal CA secret (once per cluster)

```bash
# Generate a self-signed CA
openssl req -x509 -newkey rsa:4096 -days 3650 -nodes \
  -keyout ca.key -out ca.crt -subj "/CN=mallard-ca"

kubectl create secret tls mallard-ca-key-pair \
  --cert=ca.crt --key=ca.key -n cert-manager
```

### Issue a cert per team/person

Copy `client-cert-template.yaml`, set `commonName` to the team or person name (this
becomes the InfluxDB `source` tag), and apply:

```bash
kubectl apply -f my-client-cert.yaml
```

### Export cert for VS Code extension

```bash
kubectl get secret mallard-client-team-alpha-tls -n mallard \
  -o jsonpath='{.data.tls\.crt}' | base64 -d > team-alpha.crt
kubectl get secret mallard-client-team-alpha-tls -n mallard \
  -o jsonpath='{.data.tls\.key}' | base64 -d > team-alpha.key
```

Configure in the extension: `mallard.shared.certificate.file` and `mallard.shared.certificate.keyFile`.
