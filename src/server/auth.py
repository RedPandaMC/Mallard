"""API key hashing utilities: SHA-256 + hmac.compare_digest for constant-time comparison."""

from __future__ import annotations

import hashlib
import hmac
from typing import Iterable


def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _constant_time_match(candidate_hash: str, stored_hashes: Iterable[str]) -> bool:
    """Return True if candidate_hash matches any stored hash using constant-time comparison."""
    matched = False
    for stored in stored_hashes:
        # hmac.compare_digest requires equal-length strings; both are hex SHA-256 (64 chars)
        if hmac.compare_digest(candidate_hash, stored):
            matched = True
            # Do NOT break — continue iterating to avoid timing leaks about set size
    return matched


def _lookup_label(candidate_hash: str, stored: dict[str, str]) -> str | None:
    """Constant-time lookup in a hash→label dict. Returns the label or None if not found.

    Iterates the full dict without early exit to avoid leaking the store size via timing.
    """
    matched_label: str | None = None
    for stored_hash, label in stored.items():
        if hmac.compare_digest(candidate_hash, stored_hash):
            matched_label = label
    return matched_label
