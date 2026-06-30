"""Credential verification hierarchy — static (env vars) or remote (Infisical / OpenBao)."""

from __future__ import annotations

import asyncio
import hashlib
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


# ── Value objects ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class VerifiedIdentity:
    label: str


@dataclass
class CredentialStore:
    api_keys: dict[str, str] = field(default_factory=dict)       # hash → label
    mqtt_credentials: dict[str, str] = field(default_factory=dict)
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
            result[hashlib.sha256(key.encode()).hexdigest()] = label
        return result


# ── Abstract base ─────────────────────────────────────────────────────────────


class CredentialVerifier(ABC):
    @abstractmethod
    async def verify_api_key(self, key: str) -> VerifiedIdentity | None: ...

    @abstractmethod
    async def verify_mqtt_credential(self, password: str) -> VerifiedIdentity | None: ...


# ── Static (env vars, no I/O) ─────────────────────────────────────────────────


class StaticCredentialVerifier(CredentialVerifier):
    def __init__(self, settings: "Settings") -> None:
        self._settings = settings

    async def verify_api_key(self, key: str) -> VerifiedIdentity | None:
        h = hashlib.sha256(key.encode()).hexdigest()
        label = _lookup_label(h, self._settings.hashed_api_keys)
        return VerifiedIdentity(label) if label is not None else None

    async def verify_mqtt_credential(self, password: str) -> VerifiedIdentity | None:
        h = hashlib.sha256(password.encode()).hexdigest()
        label = _lookup_label(h, self._settings.hashed_mqtt_credentials)
        return VerifiedIdentity(label) if label is not None else None


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
        h = hashlib.sha256(key.encode()).hexdigest()
        label = _lookup_label(h, store.api_keys)
        return VerifiedIdentity(label) if label is not None else None

    async def verify_mqtt_credential(self, password: str) -> VerifiedIdentity | None:
        store = await self._get_store()
        h = hashlib.sha256(password.encode()).hexdigest()
        label = _lookup_label(h, store.mqtt_credentials)
        return VerifiedIdentity(label) if label is not None else None


# ── Infisical ─────────────────────────────────────────────────────────────────


class InfisicalCredentialVerifier(RemoteCredentialVerifier):
    async def _fetch_store(self) -> CredentialStore:
        s = self._settings
        ca = s.secret_manager_ca_cert_path or True
        async with httpx.AsyncClient(verify=ca, timeout=10.0) as c:
            r = await c.get(
                f"{s.secret_manager_url}/api/v3/secrets/raw",
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
        return CredentialStore(
            api_keys=CredentialStore.parse_labeled(kv.get("API_KEYS", "")),
            mqtt_credentials=CredentialStore.parse_labeled(kv.get("MQTT_CREDENTIALS", "")),
        )


# ── OpenBao ───────────────────────────────────────────────────────────────────


class OpenBaoCredentialVerifier(RemoteCredentialVerifier):
    async def _fetch_store(self) -> CredentialStore:
        s = self._settings
        headers: dict[str, str] = {"X-Vault-Token": s.secret_manager_token}
        if s.openbao_namespace:
            headers["X-Vault-Namespace"] = s.openbao_namespace
        async with httpx.AsyncClient(verify=s.secret_manager_ca_cert_path or True, timeout=10.0) as c:
            r = await c.get(f"{s.secret_manager_url}/v1/{s.openbao_secret_path}", headers=headers)
        r.raise_for_status()
        try:
            data = r.json()["data"]["data"]
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"Unexpected OpenBao response shape: {exc}") from exc
        return CredentialStore(
            api_keys=CredentialStore.parse_labeled(data.get("api_keys", "")),
            mqtt_credentials=CredentialStore.parse_labeled(data.get("mqtt_credentials", "")),
        )


# ── Factory ───────────────────────────────────────────────────────────────────


def create_verifier(settings: "Settings") -> CredentialVerifier:
    """Return the appropriate verifier implementation for the configured secret manager."""
    if settings.secret_manager_type == "infisical":
        return InfisicalCredentialVerifier(settings)
    if settings.secret_manager_type == "openbao":
        return OpenBaoCredentialVerifier(settings)
    return StaticCredentialVerifier(settings)
