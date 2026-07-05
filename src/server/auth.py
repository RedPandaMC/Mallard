"""Constant-time credential-hash lookup used by the credential verifiers."""

from __future__ import annotations

import hmac


def _lookup_label(candidate_hash: str, stored: dict[str, str]) -> str | None:
    """Constant-time lookup in a hash→label dict. Returns the label or None if not found.

    Iterates the full dict without early exit to avoid leaking the store size via timing.
    """
    matched_label: str | None = None
    for stored_hash, label in stored.items():
        if hmac.compare_digest(candidate_hash, stored_hash):
            matched_label = label
    return matched_label
