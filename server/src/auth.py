"""API key validation: SHA-256 hashing + hmac.compare_digest for constant-time comparison."""

from __future__ import annotations

import hashlib
import hmac
import logging

from fastapi import HTTPException, Security, status
from fastapi.security import APIKeyHeader

from .config import get_settings

logger = logging.getLogger(__name__)

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _constant_time_match(candidate_hash: str, stored_hashes: set[str]) -> bool:
    """Return True if candidate_hash matches any stored hash using constant-time comparison."""
    matched = False
    for stored in stored_hashes:
        # hmac.compare_digest requires equal-length strings; both are hex SHA-256 (64 chars)
        if hmac.compare_digest(candidate_hash, stored):
            matched = True
            # Do NOT break — continue iterating to avoid timing leaks about set size
    return matched


async def require_api_key(raw_key: str | None = Security(_api_key_header)) -> str:
    """
    FastAPI dependency.  Raises HTTP 401 if the key is absent or invalid.
    Returns the SHA-256 hex digest of the validated key (safe to log).
    The raw key value is never logged.
    """
    if not raw_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-API-Key header",
        )

    candidate_hash = _hash_key(raw_key)
    settings = get_settings()

    if not _constant_time_match(candidate_hash, settings.hashed_api_keys):
        # Log only the first 8 chars of the hash — never the raw key
        logger.warning("Rejected API key with hash prefix %s…", candidate_hash[:8])
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )

    logger.debug("Authenticated API key hash prefix %s…", candidate_hash[:8])
    return candidate_hash
