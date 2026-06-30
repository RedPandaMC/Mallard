"""FastAPI dependency providers."""

from __future__ import annotations

from fastapi import Request

from .credential_verifier import CredentialVerifier


def get_verifier(request: Request) -> CredentialVerifier:
    return request.app.state.verifier
