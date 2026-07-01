#!/usr/bin/env bash
# Run against an unsealed OpenBao instance (BAO_ADDR and BAO_TOKEN must be set).
#
# Produces a client token via AppRole login and prints it directly — the
# Mallard server polls OpenBao with this token (X-Vault-Token header, 30s TTL
# cache), the same live-fetch code path used against Docker Compose's OpenBao.
# There's no agent/sidecar in this setup: the app talks to OpenBao itself.
set -euo pipefail

BAO_ADDR="${BAO_ADDR:-http://openbao.openbao.svc.cluster.local:8200}"

echo "Enabling KV v2 secrets engine at secret/..."
bao secrets enable -path=secret kv-v2 2>/dev/null || echo "(already enabled)"

echo "Writing mallard policy..."
bao policy write mallard server/k8s/openbao/policy-mallard.hcl

echo "Enabling AppRole auth method..."
bao auth enable approle 2>/dev/null || echo "(already enabled)"

echo "Creating mallard AppRole..."
# A long TTL keeps this low-maintenance for a first setup, but the server
# never calls the renew-self endpoint, so this token still expires after
# token_max_ttl regardless of use. Re-run this script (or `bao token renew`)
# before then, or script your own renewal if you want it fully hands-off.
bao write auth/approle/role/mallard \
  token_policies=mallard \
  token_ttl=720h \
  token_max_ttl=2160h \
  secret_id_ttl=0

ROLE_ID=$(bao read -field=role_id auth/approle/role/mallard/role-id)
SECRET_ID=$(bao write -field=secret_id -f auth/approle/role/mallard/secret-id)
CLIENT_TOKEN=$(bao write -field=token auth/approle/login role_id="${ROLE_ID}" secret_id="${SECRET_ID}")

echo ""
echo "Client token (store this in the mallard-openbao-secrets K8s Secret):"
echo "  SECRET_MANAGER_TOKEN: ${CLIENT_TOKEN}"
echo ""
echo "Create the K8s secret:"
echo "  kubectl create secret generic mallard-openbao-secrets \\"
echo "    --from-literal=SECRET_MANAGER_TOKEN=${CLIENT_TOKEN} \\"
echo "    -n mallard"
echo ""
echo "This token expires after token_max_ttl (2160h / 90 days) regardless of"
echo "use — re-run this script before then to issue a new one. To revoke it"
echo "immediately instead, run: bao token revoke <token>"
