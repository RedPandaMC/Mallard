"""JWT bearer authentication for the ingest endpoint.

Covers the unit verifier (`_verify_jwt` / `StaticCredentialVerifier.verify_jwt`)
and the end-to-end route path, including the algorithm-confusion guard.
"""

from __future__ import annotations

import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from server.credential_verifier import JwtConfig, _verify_jwt

from .conftest import JWT_HMAC_SECRET

HS_SECRET = "unit-test-hs-secret"


def _hs_token(claims: dict, secret: str = HS_SECRET) -> str:
    return jwt.encode(claims, secret, algorithm="HS256")


@pytest.fixture(scope="module")
def rsa_keys() -> tuple[str, str]:
    """(private_pem, public_pem) for RS256 tests."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public_pem = (
        key.public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        .decode()
    )
    return private_pem, public_pem


class TestVerifyJwtUnit:
    async def test_disabled_when_no_material(self) -> None:
        token = _hs_token({"sub": "x", "exp": time.time() + 60})
        assert await _verify_jwt(token, JwtConfig()) is None

    async def test_valid_hs256_maps_claim_to_label(self) -> None:
        cfg = JwtConfig(hmac_secret=HS_SECRET, labels={"ci-bot": "ci"})
        token = _hs_token({"sub": "ci-bot", "exp": time.time() + 60})
        identity = await _verify_jwt(token, cfg)
        assert identity is not None and identity.label == "ci"

    async def test_unmapped_claim_uses_claim_value(self) -> None:
        cfg = JwtConfig(hmac_secret=HS_SECRET)
        token = _hs_token({"sub": "team-x", "exp": time.time() + 60})
        identity = await _verify_jwt(token, cfg)
        assert identity is not None and identity.label == "team-x"

    async def test_expired_token_rejected(self) -> None:
        cfg = JwtConfig(hmac_secret=HS_SECRET)
        token = _hs_token({"sub": "x", "exp": time.time() - 1})
        assert await _verify_jwt(token, cfg) is None

    async def test_missing_exp_rejected(self) -> None:
        cfg = JwtConfig(hmac_secret=HS_SECRET)
        token = _hs_token({"sub": "x"})
        assert await _verify_jwt(token, cfg) is None

    async def test_bad_signature_rejected(self) -> None:
        cfg = JwtConfig(hmac_secret=HS_SECRET)
        token = _hs_token({"sub": "x", "exp": time.time() + 60}, secret="wrong-secret")
        assert await _verify_jwt(token, cfg) is None

    async def test_issuer_and_audience_enforced(self) -> None:
        cfg = JwtConfig(hmac_secret=HS_SECRET, issuer="mallard", audience="ingest")
        good = _hs_token({"sub": "x", "iss": "mallard", "aud": "ingest", "exp": time.time() + 60})
        assert (await _verify_jwt(good, cfg)) is not None
        bad_iss = _hs_token({"sub": "x", "iss": "evil", "aud": "ingest", "exp": time.time() + 60})
        assert await _verify_jwt(bad_iss, cfg) is None

    async def test_valid_rs256(self, rsa_keys: tuple[str, str]) -> None:
        private_pem, public_pem = rsa_keys
        cfg = JwtConfig(public_key=public_pem, algorithms=("RS256",))
        token = jwt.encode({"sub": "svc", "exp": time.time() + 60}, private_pem, algorithm="RS256")
        identity = await _verify_jwt(token, cfg)
        assert identity is not None and identity.label == "svc"

    async def test_algorithm_confusion_blocked(self, rsa_keys: tuple[str, str]) -> None:
        """With only an RSA public key configured, an HS256 token (the shape of an
        algorithm-confusion forgery, where the attacker signs with the public-key
        bytes as an HMAC secret) must be rejected — HS* is never in the allowed
        algorithm set when asymmetric material is configured."""
        _private_pem, public_pem = rsa_keys
        cfg = JwtConfig(public_key=public_pem, algorithms=("RS256",))
        # Any HS256 token must be refused at decode because algorithms=["RS256"].
        forged = jwt.encode({"sub": "attacker", "exp": time.time() + 60}, "any-secret", algorithm="HS256")
        assert await _verify_jwt(forged, cfg) is None


class TestJwtRoute:
    def test_valid_jwt_authenticates_and_tags_source(
        self, jwt_client: TestClient, valid_payload: dict
    ) -> None:
        from unittest.mock import patch

        token = _hs_token({"sub": "ci-bot", "exp": time.time() + 60}, secret=JWT_HMAC_SECRET)
        with patch("server.routers.ingest.write_payload") as write_mock:
            response = jwt_client.post(
                "/api/v1/ingest",
                json=valid_payload,
                headers={"Authorization": f"Bearer {token}"},
            )
        assert response.status_code == 202
        assert write_mock.call_args.kwargs["source"] == "ci"

    def test_expired_jwt_rejected(self, jwt_client: TestClient, valid_payload: dict) -> None:
        token = _hs_token({"sub": "ci-bot", "exp": time.time() - 1}, secret=JWT_HMAC_SECRET)
        response = jwt_client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 401

    def test_non_jwt_bearer_still_treated_as_api_key(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        """When JWT isn't configured, a plain bearer token remains an API key."""
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"Authorization": "Bearer test-key-valid"},
        )
        assert response.status_code == 202
