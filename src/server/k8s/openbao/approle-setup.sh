#!/usr/bin/env bash
# Run against an unsealed OpenBao instance (BAO_ADDR and BAO_TOKEN must be set).
set -euo pipefail

BAO_ADDR="${BAO_ADDR:-http://openbao.openbao.svc.cluster.local:8200}"

echo "Enabling KV v2 secrets engine at secret/..."
bao secrets enable -path=secret kv-v2 2>/dev/null || echo "(already enabled)"

echo "Writing mallard policy..."
bao policy write mallard server/k8s/openbao/policy-mallard.hcl

echo "Enabling AppRole auth method..."
bao auth enable approle 2>/dev/null || echo "(already enabled)"

echo "Creating mallard AppRole..."
bao write auth/approle/role/mallard \
  token_policies=mallard \
  token_ttl=1h \
  token_max_ttl=4h \
  secret_id_ttl=0

ROLE_ID=$(bao read -field=role_id auth/approle/role/mallard/role-id)
SECRET_ID=$(bao write -field=secret_id -f auth/approle/role/mallard/secret-id)

echo ""
echo "AppRole credentials (store these as Kubernetes Secrets):"
echo "  ROLE_ID:   ${ROLE_ID}"
echo "  SECRET_ID: ${SECRET_ID}"
echo ""
echo "Create the K8s secret:"
echo "  kubectl create secret generic openbao-approle-credentials \\"
echo "    --from-literal=roleId=${ROLE_ID} \\"
echo "    --from-literal=secretId=${SECRET_ID} \\"
echo "    -n mallard"
