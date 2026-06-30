# TLS and cert-manager

## Overview

Mallard uses cert-manager to automate TLS certificate management in Kubernetes. Four ClusterIssuers are provided:

| Issuer | Use case |
|---|---|
| `letsencrypt-staging` | CI/testing — ACME staging, no rate limits |
| `letsencrypt-prod` | Production — matches the `ingress.yaml` annotation |
| `selfsigned` | Air-gapped / dev clusters |
| `mallard-ca` | Internal CA for mTLS client certificates |

## Install cert-manager

```bash
helm repo add jetstack https://charts.jetstack.io --force-update
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true

kubectl apply -f server/k8s/cert-manager/
```

## Switch the server TLS issuer

Edit the annotation in `server/k8s/ingress.yaml`:

```yaml
cert-manager.io/cluster-issuer: letsencrypt-prod   # or letsencrypt-staging, selfsigned
```

## mTLS client certificates

The nginx Ingress forwards the client cert's Common Name as the `SSL_CLIENT_S_DN_CN` header. The server uses this as the InfluxDB `source` tag — no API key needed for certificate-authenticated clients.

### 1. Create the internal CA (once per cluster)

```bash
openssl req -x509 -newkey rsa:4096 -days 3650 -nodes \
  -keyout ca.key -out ca.crt -subj "/CN=mallard-ca"

kubectl create secret tls mallard-ca-key-pair \
  --cert=ca.crt --key=ca.key -n cert-manager
```

### 2. Issue a client certificate

Copy `server/k8s/cert-manager/client-cert-template.yaml`, set `commonName` to the team or person name (this becomes the InfluxDB `source` tag), and apply:

```bash
cp server/k8s/cert-manager/client-cert-template.yaml my-client-cert.yaml
# Edit: metadata.name, spec.secretName, spec.commonName
kubectl apply -f my-client-cert.yaml
```

### 3. Export the certificate for the VS Code extension

```bash
kubectl get secret mallard-client-team-alpha-tls -n mallard \
  -o jsonpath='{.data.tls\.crt}' | base64 -d > team-alpha.crt
kubectl get secret mallard-client-team-alpha-tls -n mallard \
  -o jsonpath='{.data.tls\.key}' | base64 -d > team-alpha.key
```

Configure in the extension: `mallard.shared.certificate.file` and `mallard.shared.certificate.keyFile`.

## Verify

```bash
kubectl get clusterissuer
kubectl get certificate -n mallard
# Both should show READY=True
```
