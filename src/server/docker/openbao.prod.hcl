# Production-oriented OpenBao config for the Compose overlay.
# Integrated raft storage on a persistent volume (survives restarts).
#
# TLS is ON: the server sends its X-Vault-Token on every credential fetch, and
# anything with a foothold on the internal Docker network could otherwise sniff
# that token off plaintext HTTP. Generate an internal CA + a cert whose SAN
# covers the "openbao" service name and point OPENBAO_TLS_DIR at the directory
# (see docker-compose.openbao.prod.yml), e.g.:
#   openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
#     -keyout ca.key -out ca.crt -subj "/CN=mallard-internal-ca" -days 1825
#   openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
#     -keyout openbao.key -out openbao.csr -subj "/CN=openbao"
#   openssl x509 -req -in openbao.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
#     -out openbao.crt -days 825 -extfile <(echo "subjectAltName=DNS:openbao")
storage "raft" {
  path    = "/openbao/data"
  node_id = "mallard-openbao-1"
}

listener "tcp" {
  address       = "0.0.0.0:8200"
  tls_disable   = false
  tls_cert_file = "/openbao/tls/openbao.crt"
  tls_key_file  = "/openbao/tls/openbao.key"
}

api_addr     = "https://openbao:8200"
cluster_addr = "https://openbao:8201"
ui           = false
disable_mlock = false
