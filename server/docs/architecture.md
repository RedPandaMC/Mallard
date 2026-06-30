# Mallard Architecture

## Overview

Mallard is a metrics ingest server designed for VS Code telemetry. It accepts data over HTTP webhook and/or MQTT WebSocket, validates credentials, tags each data point with the sender's identity, and writes to InfluxDB.

```
┌─────────────────────────────────────────────────────────────┐
│  VS Code Extension                                          │
│  ┌─────────────┐    HTTP POST /api/v1/ingest               │
│  │ Webhook     │────────────────────────────────────┐      │
│  │ transport   │    X-API-Key / Bearer / mTLS cert  │      │
│  └─────────────┘                                    │      │
│  ┌─────────────┐    WSS /mqtt (MQTT CONNECT)        │      │
│  │ MQTT        │────────────────────────────────────┼──┐   │
│  │ transport   │    password credential              │  │   │
│  └─────────────┘                                    │  │   │
└─────────────────────────────────────────────────────┘  │   │
                                                         │   │
┌────────────── Mallard Server ───────────────────────────┼───┼─┐
│                                                         │   │ │
│  ┌──────────────────┐  ┌────────────────────────────┐  │   │ │
│  │ Caddy / nginx    │◄─┤   Ingress (K8s)            │  │   │ │
│  │ TLS termination  │  │   mTLS optional             │  │   │ │
│  │ mTLS forwarding  │  └────────────────────────────┘  │   │ │
│  └────────┬─────────┘                                  │   │ │
│           │  SSL_CLIENT_S_DN_CN header                  │   │ │
│  ┌────────▼─────────────────────────────────────────┐  │   │ │
│  │ FastAPI  (port 8080)                             │◄─┘   │ │
│  │  POST /api/v1/ingest                             │      │ │
│  │    CredentialVerifier.verify_api_key()           │      │ │
│  │    source = cert CN | API key label | "unknown"  │      │ │
│  └────────────────────┬─────────────────────────────┘      │ │
│                       │                                     │ │
│  ┌────────────────────▼─────────────────────────────────┐  │ │
│  │ amqtt Broker  (port 8083, MQTT over WS)              │◄─┘ │
│  │  _MallardAuthPlugin.authenticate()                   │    │
│  │    CredentialVerifier.verify_mqtt_credential()       │    │
│  │  _MallardMessagePlugin.on_broker_message_received()  │    │
│  │    source = client_labels[client_id]                 │    │
│  └────────────────────┬─────────────────────────────────┘    │
│                       │                                       │
│  ┌────────────────────▼─────────────────────────────────┐    │
│  │ CredentialVerifier (injected via app.state.verifier)  │   │
│  │  StaticCredentialVerifier  (env var hashes)           │   │
│  │  InfisicalCredentialVerifier  (TTL cache + HTTP)      │   │
│  │  OpenBaoCredentialVerifier    (TTL cache + HTTP)      │   │
│  └────────────────────┬─────────────────────────────────┘    │
│                       │                                       │
│  ┌────────────────────▼─────────────────────────────────┐    │
│  │ InfluxDB writer                                       │   │
│  │  write_payload(measurement, fields, tags, source)     │   │
│  │  Point tagged: source=<identity-label>                │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
           │
           ▼
     InfluxDB :8086   →   Grafana :3000
```

## Component roles

| Component | Responsibility |
|---|---|
| FastAPI app | HTTP ingest endpoint, health check, rate limiting |
| amqtt broker | MQTT broker embedded in the same process; WebSocket transport on port 8083 |
| CredentialVerifier | Auth and identity resolution — static (env) or remote (Infisical/OpenBao) |
| InfluxDB writer | Writes tagged time-series points; `source` tag identifies the sender |
| Caddy (Docker) | TLS termination, optional mTLS client auth, reverse proxy |
| nginx Ingress (K8s) | TLS termination, optional mTLS via cert-manager annotations |

## HTTP data flow

1. Extension sends `POST /api/v1/ingest` with credential.
2. Caddy/nginx terminates TLS; for mTLS passes `SSL_CLIENT_S_DN_CN` header.
3. FastAPI ingest router:
   - If `SSL_CLIENT_S_DN_CN` is present and non-empty → `source = cert CN`.
   - Else: extract key from `X-API-Key` or `Authorization: Bearer <token>`.
   - Call `verifier.verify_api_key(key)` → `VerifiedIdentity(label)` or 401.
   - `source = identity.label`.
4. `write_payload()` writes to InfluxDB with `.tag("source", source)`.

## MQTT data flow

1. Extension opens WebSocket to `/mqtt`; Caddy/nginx proxies to amqtt port 8083.
2. amqtt CONNECT: `_MallardAuthPlugin.authenticate()` calls `verifier.verify_mqtt_credential(password)`.
3. On success: `client_labels[client_id] = identity.label`.
4. On PUBLISH: `_MallardMessagePlugin` reads `source = client_labels[client_id]` and calls `_handle_message(..., source=source)`.
5. On DISCONNECT: `client_labels` entry is cleaned up.
