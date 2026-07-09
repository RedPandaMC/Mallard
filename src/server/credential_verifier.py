"""Credential verification hierarchy — static (env vars / K8s Secret) or remote (OpenBao).

Label model ("tracking cookie" semantics, server-side only):
- API keys (and Bearer tokens, which hit the same store) carry a `label:secret`
  mapping so analytics can filter the Influx `source` tag by team/person.
- mTLS client certs are labeled via an optional CERT_LABELS `label:cn` map;
  a CN without an entry falls back to the CN itself as the source.
- MQTT uses one shared broker password and everything it ingests is tagged
  source='mqtt' — there is deliberately no per-client label store for MQTT.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import re
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from functools import lru_cache
from typing import TYPE_CHECKING

import httpx
import jwt
from jwt import PyJWKClient

from .auth import _lookup_label

if TYPE_CHECKING:
    from .config import Settings

logger = logging.getLogger(__name__)

# Labels become InfluxDB tag values; restrict to safe characters and reasonable length.
_LABEL_RE = re.compile(r"^[\w._@-]{1,64}$")

# Cert CommonNames share the same safe charset (mirrors _CERT_CN_RE in routers/ingest.py).
_CN_RE = re.compile(r"^[\w._@-]{1,64}$")


def _sha256(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


# ── Value objects ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class VerifiedIdentity:
    label: str


@dataclass(frozen=True)
class JwtConfig:
    """JWT verification material. Symmetric (HS*) via `hmac_secret`, or asymmetric
    (RS*/ES*/PS*) via a PEM `public_key` or a `jwks_url`. `labels` maps the value of
    `label_claim` (default 'sub') to a source label; an unmapped value uses the claim
    value itself. Empty material → JWT disabled (`enabled` is False)."""

    hmac_secret: str = ""
    public_key: str = ""            # PEM (RS/ES/PS)
    jwks_url: str = ""
    algorithms: tuple[str, ...] = ()
    issuer: str = ""
    audience: str = ""
    label_claim: str = "sub"
    labels: dict[str, str] = field(default_factory=dict)  # claim-value → label

    @property
    def enabled(self) -> bool:
        return bool(self.hmac_secret or self.public_key or self.jwks_url)


@dataclass
class CredentialStore:
    api_keys: dict[str, str] = field(default_factory=dict)     # sha256(key) → label
    cert_labels: dict[str, str] = field(default_factory=dict)  # cn → label
    mqtt_password_hash: str | None = None                      # sha256 of the shared password
    webhook_hmac_secrets: list[str] = field(default_factory=list)  # plain values (needed for HMAC)
    jwt: JwtConfig = field(default_factory=JwtConfig)
    fetched_at: float = field(default_factory=time.monotonic)

    @staticmethod
    def parse_labeled(raw: str) -> dict[str, str]:
        """'label:secret,...' → {sha256(secret): label}. Bare values get label 'unknown'.

        Labels that contain characters outside [A-Za-z0-9._@-] or exceed 64 characters
        are normalised to 'unknown' to keep InfluxDB tags clean.
        """
        result: dict[str, str] = {}
        for entry in (e.strip() for e in raw.split(",") if e.strip()):
            label, _, key = entry.partition(":")
            if not key:
                label, key = "unknown", label
            label = label.strip()
            if not _LABEL_RE.match(label):
                label = "unknown"
            result[_sha256(key)] = label
        return result

    @staticmethod
    def parse_secret_list(raw: str) -> list[str]:
        """Comma-separated plain secrets → list. Used for the HMAC signing secrets,
        which must stay available in plaintext (HMAC needs the key itself) and are
        unlabeled — the signature authenticates the body, the API key identifies
        the sender."""
        return [s for s in (e.strip() for e in raw.split(",")) if s]

    @staticmethod
    def parse_cert_labels(raw: str) -> dict[str, str]:
        """'label:cn,...' → {cn: label}. Entries with a missing/invalid label or CN
        are skipped (a bad mapping must not silently relabel someone else's data)."""
        result: dict[str, str] = {}
        for entry in (e.strip() for e in raw.split(",") if e.strip()):
            label, sep, cn = entry.partition(":")
            label, cn = label.strip(), cn.strip()
            if not sep or not _LABEL_RE.match(label) or not _CN_RE.match(cn):
                logger.warning("Skipping malformed CERT_LABELS entry: %r", entry)
                continue
            result[cn] = label
        return result


# ── Abstract base ─────────────────────────────────────────────────────────────


class CredentialVerifier(ABC):
    @abstractmethod
    async def verify_api_key(self, key: str) -> VerifiedIdentity | None: ...

    @abstractmethod
    async def verify_mqtt_password(self, password: str) -> bool: ...

    @abstractmethod
    async def verify_jwt(self, token: str) -> VerifiedIdentity | None:
        """Verify a signed JWT bearer token. Returns None when JWT auth is not
        configured or the token is invalid/expired."""
        ...

    @abstractmethod
    async def lookup_cert_label(self, cn: str) -> str | None: ...

    @abstractmethod
    async def get_webhook_hmac_secrets(self) -> list[str]:
        """Signing secrets for X-Mallard-Signature-256 verification.
        Empty list = signature checking disabled."""
        ...

    async def healthcheck(self) -> bool:
        """True when the credential store is reachable. Static verifiers have no
        remote dependency, so the default is always True; remote verifiers
        override this to probe the secret manager."""
        return True


def _match_mqtt_password(candidate: str, stored_hash: str | None) -> bool:
    if not stored_hash:
        return False
    return hmac.compare_digest(_sha256(candidate), stored_hash)


# ── JWT ───────────────────────────────────────────────────────────────────────

_ASYMMETRIC_PREFIXES = ("RS", "ES", "PS")

# Secret-manager KV keys carrying JWT config (OpenBao uses these names verbatim).
_JWT_KV_KEYS = (
    "jwt_hmac_secret",
    "jwt_public_key",
    "jwt_jwks_url",
    "jwt_algorithms",
    "jwt_issuer",
    "jwt_audience",
    "jwt_label_claim",
    "jwt_labels",
)


def _jwt_config_from(raw: dict[str, str]) -> JwtConfig:
    """Build a JwtConfig from a flat KV mapping (secret-manager blob or env).

    Keys: jwt_hmac_secret, jwt_public_key, jwt_jwks_url, jwt_algorithms (CSV),
    jwt_issuer, jwt_audience, jwt_label_claim, jwt_labels ('label:claimvalue,...').
    """
    algorithms = tuple(
        a.strip() for a in raw.get("jwt_algorithms", "").split(",") if a.strip()
    )
    return JwtConfig(
        hmac_secret=raw.get("jwt_hmac_secret", "").strip(),
        public_key=raw.get("jwt_public_key", "").strip(),
        jwks_url=raw.get("jwt_jwks_url", "").strip(),
        algorithms=algorithms,
        issuer=raw.get("jwt_issuer", "").strip(),
        audience=raw.get("jwt_audience", "").strip(),
        label_claim=raw.get("jwt_label_claim", "").strip() or "sub",
        # Reuse the cert-label parser: same 'label:value' shape (value = claim value).
        labels=CredentialStore.parse_cert_labels(raw.get("jwt_labels", "")),
    )


@lru_cache(maxsize=16)
def _jwks_client(url: str) -> PyJWKClient:
    """Cache one PyJWKClient per JWKS URL so signing keys are fetched/cached once."""
    return PyJWKClient(url, cache_keys=True)


async def _resolve_jwt_key(token: str, cfg: JwtConfig) -> tuple[object, list[str]]:
    """Resolve the verification key and the *allowed* algorithm list.

    Algorithms are derived from the configured key material — never from the
    token header — to prevent an algorithm-confusion attack (an attacker signing
    an HS256 token using the RSA public key as the HMAC secret). HS* is only
    permitted when a symmetric secret is the sole configured material.
    """
    if cfg.public_key or cfg.jwks_url:
        algs = [a for a in cfg.algorithms if a.startswith(_ASYMMETRIC_PREFIXES)] or [
            "RS256",
            "ES256",
        ]
        if cfg.jwks_url:
            signing_key = await asyncio.to_thread(
                _jwks_client(cfg.jwks_url).get_signing_key_from_jwt, token
            )
            return signing_key.key, algs
        return cfg.public_key, algs
    algs = [a for a in cfg.algorithms if a.startswith("HS")] or ["HS256"]
    return cfg.hmac_secret, algs


async def _verify_jwt(token: str, cfg: JwtConfig) -> VerifiedIdentity | None:
    """Verify a JWT and return the source identity, or None if JWT auth is
    disabled or the token is invalid/expired."""
    if not cfg.enabled:
        return None
    try:
        key, algorithms = await _resolve_jwt_key(token, cfg)
        options: dict[str, object] = {"require": ["exp"]}
        decode_kwargs: dict[str, object] = {"algorithms": algorithms, "options": options}
        if cfg.issuer:
            decode_kwargs["issuer"] = cfg.issuer
        if cfg.audience:
            decode_kwargs["audience"] = cfg.audience
        else:
            options["verify_aud"] = False
        claims = jwt.decode(token, key, **decode_kwargs)  # type: ignore[arg-type]
    except jwt.PyJWTError as exc:
        logger.info("JWT verification failed: %s", exc)
        return None
    claim_value = str(claims.get(cfg.label_claim, "")).strip()
    if not claim_value:
        return None
    label = cfg.labels.get(claim_value)
    if label is None:
        label = claim_value if _LABEL_RE.match(claim_value) else "unknown"
    return VerifiedIdentity(label)


def _looks_like_jwt(token: str) -> bool:
    """A compact JWS has three dot-separated base64url segments."""
    return token.count(".") == 2 and all(token.split("."))


# ── Static (env vars, no I/O) ─────────────────────────────────────────────────


class StaticCredentialVerifier(CredentialVerifier):
    def __init__(self, settings: "Settings") -> None:
        self._settings = settings

    async def verify_api_key(self, key: str) -> VerifiedIdentity | None:
        label = _lookup_label(_sha256(key), self._settings.hashed_api_keys)
        return VerifiedIdentity(label) if label is not None else None

    async def verify_mqtt_password(self, password: str) -> bool:
        stored = self._settings.mqtt_password
        return _match_mqtt_password(password, _sha256(stored) if stored else None)

    async def verify_jwt(self, token: str) -> VerifiedIdentity | None:
        return await _verify_jwt(token, self._settings.parsed_jwt)

    async def lookup_cert_label(self, cn: str) -> str | None:
        return self._settings.parsed_cert_labels.get(cn)

    async def get_webhook_hmac_secrets(self) -> list[str]:
        return self._settings.parsed_webhook_hmac_secrets


# ── Remote base (shared TTL cache logic) ──────────────────────────────────────


class RemoteCredentialVerifier(CredentialVerifier, ABC):
    def __init__(self, settings: "Settings", ttl_seconds: int = 30) -> None:
        self._settings = settings
        self._ttl = ttl_seconds
        self._store: CredentialStore | None = None
        self._lock = asyncio.Lock()

    @abstractmethod
    async def _fetch_store(self) -> CredentialStore: ...

    async def _get_store(self) -> CredentialStore:
        async with self._lock:
            now = time.monotonic()
            if self._store is None or (now - self._store.fetched_at) > self._ttl:
                try:
                    self._store = await self._fetch_store()
                except Exception as exc:
                    if self._store is not None:
                        # Keep serving from stale cache while the secret manager recovers.
                        logger.warning("credential fetch failed, using stale cache: %s", exc)
                    else:
                        raise  # no cache to fall back to — caller gets a 503
        return self._store  # type: ignore[return-value]  # guarded: either set or raised above

    async def verify_api_key(self, key: str) -> VerifiedIdentity | None:
        store = await self._get_store()
        label = _lookup_label(_sha256(key), store.api_keys)
        return VerifiedIdentity(label) if label is not None else None

    async def verify_mqtt_password(self, password: str) -> bool:
        store = await self._get_store()
        return _match_mqtt_password(password, store.mqtt_password_hash)

    async def verify_jwt(self, token: str) -> VerifiedIdentity | None:
        store = await self._get_store()
        return await _verify_jwt(token, store.jwt)

    async def lookup_cert_label(self, cn: str) -> str | None:
        store = await self._get_store()
        return store.cert_labels.get(cn)

    async def get_webhook_hmac_secrets(self) -> list[str]:
        store = await self._get_store()
        return store.webhook_hmac_secrets

    async def healthcheck(self) -> bool:
        # Reachable if we can serve a store (fresh fetch or warm cache).
        try:
            await self._get_store()
            return True
        except Exception as exc:
            logger.warning("secret manager healthcheck failed: %s", exc)
            return False


def _build_store(
    api_keys_raw: str,
    cert_labels_raw: str,
    mqtt_password: str,
    webhook_hmac_secrets_raw: str = "",
    jwt_raw: dict[str, str] | None = None,
) -> CredentialStore:
    return CredentialStore(
        api_keys=CredentialStore.parse_labeled(api_keys_raw),
        cert_labels=CredentialStore.parse_cert_labels(cert_labels_raw),
        mqtt_password_hash=_sha256(mqtt_password) if mqtt_password else None,
        webhook_hmac_secrets=CredentialStore.parse_secret_list(webhook_hmac_secrets_raw),
        jwt=_jwt_config_from(jwt_raw or {}),
    )


# ── OpenBao ───────────────────────────────────────────────────────────────────


class OpenBaoCredentialVerifier(RemoteCredentialVerifier):
    async def _fetch_store(self) -> CredentialStore:
        s = self._settings
        headers: dict[str, str] = {"X-Vault-Token": s.secret_manager_token}
        if s.openbao_namespace:
            headers["X-Vault-Namespace"] = s.openbao_namespace
        async with httpx.AsyncClient(verify=s.secret_manager_ca_cert_path or True, timeout=10.0) as c:
            r = await c.get(f"{s.secret_manager_base_url}/v1/{s.openbao_secret_path}", headers=headers)
        r.raise_for_status()
        try:
            data = r.json()["data"]["data"]
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"Unexpected OpenBao response shape: {exc}") from exc
        return _build_store(
            data.get("api_keys", ""),
            data.get("cert_labels", ""),
            data.get("mqtt_password", ""),
            data.get("webhook_hmac_secrets", ""),
            jwt_raw={low: data.get(low, "") for low in _JWT_KV_KEYS},
        )


# ── Factory ───────────────────────────────────────────────────────────────────


def create_verifier(settings: "Settings") -> CredentialVerifier:
    """Return the verifier for the configured credential backend.

    "static" (the default) reads credentials from environment variables — a
    plain .env file or Kubernetes Secret. "openbao" fetches them live from an
    OpenBao KV store so they can be rotated without a restart.
    """
    if settings.secret_manager_type == "openbao":
        return OpenBaoCredentialVerifier(settings)
    return StaticCredentialVerifier(settings)
