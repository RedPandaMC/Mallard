"""Credential verification hierarchy — static (env vars) or remote (Infisical / OpenBao).

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
from typing import TYPE_CHECKING

import httpx

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


@dataclass
class CredentialStore:
    api_keys: dict[str, str] = field(default_factory=dict)     # sha256(key) → label
    cert_labels: dict[str, str] = field(default_factory=dict)  # cn → label
    mqtt_password_hash: str | None = None                      # sha256 of the shared password
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
    async def lookup_cert_label(self, cn: str) -> str | None: ...


def _match_mqtt_password(candidate: str, stored_hash: str | None) -> bool:
    if not stored_hash:
        return False
    return hmac.compare_digest(_sha256(candidate), stored_hash)


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

    async def lookup_cert_label(self, cn: str) -> str | None:
        return self._settings.parsed_cert_labels.get(cn)


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

    async def lookup_cert_label(self, cn: str) -> str | None:
        store = await self._get_store()
        return store.cert_labels.get(cn)


def _build_store(
    api_keys_raw: str,
    cert_labels_raw: str,
    mqtt_password: str,
) -> CredentialStore:
    return CredentialStore(
        api_keys=CredentialStore.parse_labeled(api_keys_raw),
        cert_labels=CredentialStore.parse_cert_labels(cert_labels_raw),
        mqtt_password_hash=_sha256(mqtt_password) if mqtt_password else None,
    )


# ── Infisical ─────────────────────────────────────────────────────────────────


class InfisicalCredentialVerifier(RemoteCredentialVerifier):
    async def _fetch_store(self) -> CredentialStore:
        s = self._settings
        ca = s.secret_manager_ca_cert_path or True
        async with httpx.AsyncClient(verify=ca, timeout=10.0) as c:
            r = await c.get(
                f"{s.secret_manager_base_url}/api/v3/secrets/raw",
                params={
                    "workspaceId": s.infisical_project_id,
                    "environment": s.infisical_env_slug,
                },
                headers={"Authorization": f"Bearer {s.secret_manager_token}"},
            )
        r.raise_for_status()
        try:
            kv = {item["secretKey"]: item["secretValue"] for item in r.json()["secrets"]}
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"Unexpected Infisical response shape: {exc}") from exc
        return _build_store(
            kv.get("API_KEYS", ""),
            kv.get("CERT_LABELS", ""),
            kv.get("MQTT_PASSWORD", ""),
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
        )


# ── Factory ───────────────────────────────────────────────────────────────────


def create_verifier(settings: "Settings") -> CredentialVerifier:
    """Return the verifier implementation for the configured secret manager.

    `StaticCredentialVerifier` is not reachable here — `Settings.secret_manager_type`
    only accepts "infisical" or "openbao", so a real deployment always resolves to
    one of the two remote verifiers below. The static verifier remains available
    for tests that construct it directly.
    """
    if settings.secret_manager_type == "infisical":
        return InfisicalCredentialVerifier(settings)
    return OpenBaoCredentialVerifier(settings)
