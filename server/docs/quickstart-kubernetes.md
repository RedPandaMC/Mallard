# Quickstart — Kubernetes

## Prerequisites

- kubectl + a running cluster (k3s, EKS, GKE, etc.)
- Helm 3
- A domain name with DNS pointing at your cluster's ingress IP

## 1. Install cert-manager

```bash
helm repo add jetstack https://charts.jetstack.io --force-update
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true
```

Apply the ClusterIssuers (Let's Encrypt + selfsigned + internal CA):

```bash
kubectl apply -f server/k8s/cert-manager/
```

See [cert-manager.md](cert-manager.md) for issuer selection and mTLS client cert setup.

## 2. Create the namespace and secrets

```bash
kubectl apply -f server/k8s/namespace.yaml

# Fill in and apply the secrets manifest
cp server/k8s/secrets.yaml.example server/k8s/secrets.yaml
# Edit secrets.yaml — set API_KEYS, MQTT_CREDENTIALS, INFLUX_TOKEN, etc.
kubectl apply -f server/k8s/secrets.yaml
```

## 3. Apply remaining manifests

```bash
kubectl apply -f server/k8s/influxdb/
kubectl apply -f server/k8s/grafana/
kubectl apply -f server/k8s/server/
kubectl apply -f server/k8s/ingress.yaml
kubectl apply -f server/k8s/networkpolicy.yaml
kubectl apply -f server/k8s/resourcequota.yaml
```

## 4. Verify

```bash
# Ingress and TLS
kubectl get ingress -n mallard
kubectl get certificate mallard-tls -n mallard

# Server pods
kubectl get pods -n mallard -l app=mallard-server

# Test
curl https://mallard.example.com/health
# → {"status":"ok"}
```

## 5. Install Stakater Reloader (optional, for static credential rotation)

Reloader watches Secrets and triggers a rolling restart when they change:

```bash
helm repo add stakater https://stakater.github.io/stakater-charts
helm install reloader stakater/reloader --namespace reloader --create-namespace
```

The `mallard-server` Deployment already has `reloader.stakater.com/auto: "true"` — update `mallard-server-secrets` and the pods roll automatically.

## 6. Secret management (optional)

For dynamic credentials without pod restarts, see:
- [secret-management-infisical.md](secret-management-infisical.md)
- [secret-management-openbao.md](secret-management-openbao.md)
