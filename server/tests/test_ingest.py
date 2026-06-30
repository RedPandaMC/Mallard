"""Tests for POST /api/v1/ingest."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


class TestIngestHappyPath:
    def test_valid_payload_returns_202(self, client: TestClient, valid_payload: dict) -> None:
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202
        assert response.json() == {"status": "accepted"}

    def test_null_top_model_accepted(self, client: TestClient, valid_payload: dict) -> None:
        valid_payload["top_model"] = None
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202

    def test_empty_active_models_accepted(self, client: TestClient, valid_payload: dict) -> None:
        valid_payload["active_models"] = []
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202


class TestIngestAuthentication:
    def test_missing_api_key_returns_401(self, client: TestClient, valid_payload: dict) -> None:
        response = client.post("/api/v1/ingest", json=valid_payload)
        assert response.status_code == 401

    def test_wrong_api_key_returns_401(self, client: TestClient, valid_payload: dict) -> None:
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "totally-wrong-key"},
        )
        assert response.status_code == 401

    def test_second_valid_key_accepted(self, client: TestClient, valid_payload: dict) -> None:
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "second-key"},
        )
        assert response.status_code == 202

    def test_bearer_token_accepted(self, client: TestClient, valid_payload: dict) -> None:
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"Authorization": "Bearer test-key-valid"},
        )
        assert response.status_code == 202

    def test_bearer_token_wrong_returns_401(self, client: TestClient, valid_payload: dict) -> None:
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"Authorization": "Bearer totally-wrong-key"},
        )
        assert response.status_code == 401

    def test_bearer_token_empty_returns_401(self, client: TestClient, valid_payload: dict) -> None:
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"Authorization": "Bearer "},
        )
        assert response.status_code == 401

    def test_cert_cn_header_bypasses_api_key(self, client: TestClient, valid_payload: dict) -> None:
        """mTLS: ingress forwards SSL_CLIENT_S_DN_CN — no API key needed."""
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"SSL_CLIENT_S_DN_CN": "team-alpha"},
        )
        assert response.status_code == 202

    def test_cert_cn_header_wrong_api_key_still_accepted(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        """cert CN takes precedence over (even invalid) API key."""
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"SSL_CLIENT_S_DN_CN": "team-alpha", "X-API-Key": "wrong-key"},
        )
        assert response.status_code == 202

    def test_empty_cert_cn_falls_back_to_api_key(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"SSL_CLIENT_S_DN_CN": "  ", "X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202

    def test_empty_cert_cn_without_api_key_returns_401(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"SSL_CLIENT_S_DN_CN": ""},
        )
        assert response.status_code == 401


class TestIngestValidation:
    def test_malformed_json_returns_422(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/ingest",
            content=b"not valid json {{{",
            headers={"X-API-Key": "test-key-valid", "Content-Type": "application/json"},
        )
        assert response.status_code == 422

    def test_missing_required_field_returns_422(self, client: TestClient, valid_payload: dict) -> None:
        del valid_payload["instance_id"]
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 422

    def test_missing_ts_field_returns_422(self, client: TestClient, valid_payload: dict) -> None:
        del valid_payload["ts"]
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 422

    def test_wrong_type_for_numeric_field_returns_422(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        valid_payload["mtd_cost_usd"] = "not-a-number"
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 422

    def test_active_models_must_be_list(self, client: TestClient, valid_payload: dict) -> None:
        valid_payload["active_models"] = "claude-sonnet"
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 422

    def test_oversized_body_returns_413(self, client: TestClient) -> None:
        # Build a payload larger than 64 KB
        oversized = "x" * (64 * 1024 + 1)
        response = client.post(
            "/api/v1/ingest",
            content=oversized.encode(),
            headers={
                "X-API-Key": "test-key-valid",
                "Content-Type": "application/json",
                "Content-Length": str(len(oversized)),
            },
        )
        assert response.status_code == 413

    def test_empty_body_returns_422(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/ingest",
            content=b"",
            headers={"X-API-Key": "test-key-valid", "Content-Type": "application/json"},
        )
        assert response.status_code == 422


class TestIngestRouteDirectly:
    """Call the route handler directly to cover the belt-and-suspenders 413 path.

    The middleware in main.py intercepts oversized requests before they reach the
    handler, so TestClient can never trigger line 35. Calling the coroutine directly
    with a mock request bypasses the middleware and exercises the fallback check.
    """

    async def test_belt_and_suspenders_413(self, valid_payload: dict) -> None:
        from src.credential_verifier import StaticCredentialVerifier
        from src.routers.ingest import ingest
        from src.schemas import IngestPayload

        mock_request = MagicMock()
        mock_request.headers.get = MagicMock(return_value=str(64 * 1024 + 1))

        mock_settings = MagicMock()
        mock_settings.hashed_api_keys = {}
        mock_settings.hashed_mqtt_credentials = {}
        verifier = StaticCredentialVerifier(mock_settings)

        result = await ingest(
            payload=IngestPayload(**valid_payload),
            request=mock_request,
            verifier=verifier,
        )
        assert result.status_code == 413


class TestIngestInfluxFailure:
    def test_influx_write_failure_returns_503(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        with patch("src.routers.ingest.write_payload", side_effect=RuntimeError("InfluxDB down")):
            response = client.post(
                "/api/v1/ingest",
                json=valid_payload,
                headers={"X-API-Key": "test-key-valid"},
            )
        assert response.status_code == 503
        body = response.json()
        assert "detail" in body


class TestExtractBearer:
    def test_valid_bearer_header(self) -> None:
        from src.routers.ingest import _extract_bearer

        assert _extract_bearer("Bearer my-token") == "my-token"

    def test_empty_bearer_header(self) -> None:
        from src.routers.ingest import _extract_bearer

        assert _extract_bearer("Bearer ") == ""

    def test_non_bearer_header(self) -> None:
        from src.routers.ingest import _extract_bearer

        assert _extract_bearer("Basic dXNlcjpwYXNz") == ""

    def test_empty_string(self) -> None:
        from src.routers.ingest import _extract_bearer

        assert _extract_bearer("") == ""
