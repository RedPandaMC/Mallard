# Production-oriented OpenBao config for the Compose overlay.
# Integrated raft storage on a persistent volume (survives restarts), plain HTTP
# on the internal Compose network only (put TLS termination in front for real
# deployments, or set tls_disable = false with mounted certs).
storage "raft" {
  path    = "/openbao/data"
  node_id = "mallard-openbao-1"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = true
}

api_addr     = "http://openbao:8200"
cluster_addr = "http://openbao:8201"
ui           = false
disable_mlock = false
