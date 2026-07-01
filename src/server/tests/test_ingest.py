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

    def test_invalid_cert_cn_format_falls_back_to_api_key(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        """CN with invalid characters is rejected; valid API key still grants access."""
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={
                "SSL_CLIENT_S_DN_CN": "bad cn with spaces!",
                "X-API-Key": "test-key-valid",
            },
        )
        assert response.status_code == 202

    def test_invalid_cert_cn_without_api_key_returns_401(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        """CN with invalid characters + no API key → rejected."""
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"SSL_CLIENT_S_DN_CN": "bad cn with spaces!"},
        )
        assert response.status_code == 401

    def test_cert_cn_too_long_falls_back_to_api_key(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        """CN exceeding 64 characters is treated as invalid."""
        long_cn = "a" * 65
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"SSL_CLIENT_S_DN_CN": long_cn, "X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202


class TestIngestValidation:
    """The ingest endpoint is a tolerant reader: a well-formed payload that
    names a schema_version is accepted even with fields missing, wrongly
    typed, or unrecognized — see normalize.py. Only a body that isn't valid
    JSON, or has no schema_version at all, is rejected outright."""

    def test_malformed_json_returns_400(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/ingest",
            content=b"not valid json {{{",
            headers={"X-API-Key": "test-key-valid", "Content-Type": "application/json"},
        )
        assert response.status_code == 400

    def test_missing_schema_version_returns_400(self, client: TestClient, valid_payload: dict) -> None:
        del valid_payload["schema_version"]
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 400

    def test_json_array_body_returns_400(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/ingest",
            json=[1, 2, 3],
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 400

    def test_missing_instance_id_still_accepted_in_degraded_mode(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        del valid_payload["instance_id"]
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202

    def test_missing_ts_field_still_accepted_in_degraded_mode(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        del valid_payload["ts"]
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202

    def test_wrong_type_for_numeric_field_still_accepted_in_degraded_mode(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        valid_payload["mtd_cost_usd"] = "not-a-number"
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202

    def test_active_models_wrong_type_still_accepted_in_degraded_mode(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        valid_payload["active_models"] = "claude-sonnet"
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202

    def test_unknown_schema_version_accepted_in_degraded_mode(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        """A client newer than this server (schema_version the server has
        never seen) must not fail — it's ingested best-effort instead."""
        valid_payload["schema_version"] = 99
        valid_payload["a_field_this_server_has_never_heard_of"] = "future data"
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202

    def test_v1_shaped_payload_from_an_unupgraded_extension_is_accepted(
        self, client: TestClient
    ) -> None:
        """A server upgraded ahead of the extension must still accept the
        older extension's real v1 payload shape (issue #27)."""
        v1_payload = {
            "schema_version": 1,
            "ts": "2026-01-01T00:00:00.000Z",
            "model_dist": {"gpt-4o": 1.0},
            "surface_dist": {"chat": 1.0},
            "cost_dist": {"input": 0.6, "output": 0.4},
            "input_cost_ratio": 0.6,
            "credits_velocity_per_hour": 1.5,
            "mtd_budget_pct": 42.0,
            "repo_count": 2,
            "peak_usage_hour": 14,
            "daily_credit_variance": 3.2,
            "model_count": 1,
            "surface_concentration": 0.0,
            "estimated_event_ratio": 1.0,
            "forecast_basis": "linear",
            "budget_trend": 0,
            "token_per_credit": 120.0,
            "forecast_low": 100.0,
            "forecast_high": 200.0,
            "source_connector": "local",
        }
        response = client.post(
            "/api/v1/ingest",
            json=v1_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202

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

    def test_empty_body_returns_400(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/ingest",
            content=b"",
            headers={"X-API-Key": "test-key-valid", "Content-Type": "application/json"},
        )
        assert response.status_code == 400


class TestIngestRouteDirectly:
    """Call the route handler directly to cover the belt-and-suspenders 413 path.

    The middleware in main.py intercepts oversized requests before they reach the
    handler, so TestClient can never trigger line 35. Calling the coroutine directly
    with a mock request bypasses the middleware and exercises the fallback check.
    """

    async def test_belt_and_suspenders_413(self) -> None:
        from server.credential_verifier import StaticCredentialVerifier
        from server.routers.ingest import ingest

        mock_request = MagicMock()
        mock_request.headers.get = MagicMock(return_value=str(64 * 1024 + 1))

        mock_settings = MagicMock()
        mock_settings.hashed_api_keys = {}
        mock_settings.hashed_mqtt_credentials = {}
        verifier = StaticCredentialVerifier(mock_settings)

        # The 413 check runs before the body is ever read, so request.body()
        # is never awaited here.
        result = await ingest(
            request=mock_request,
            verifier=verifier,
        )
        assert result.status_code == 413


class TestIngestInfluxFailure:
    def test_influx_write_failure_returns_503(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        with patch("server.routers.ingest.write_payload", side_effect=RuntimeError("InfluxDB down")):
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
        from server.routers.ingest import _extract_bearer

        assert _extract_bearer("Bearer my-token") == "my-token"

    def test_empty_bearer_header(self) -> None:
        from server.routers.ingest import _extract_bearer

        assert _extract_bearer("Bearer ") == ""

    def test_non_bearer_header(self) -> None:
        from server.routers.ingest import _extract_bearer

        assert _extract_bearer("Basic dXNlcjpwYXNz") == ""

    def test_empty_string(self) -> None:
        from server.routers.ingest import _extract_bearer

        assert _extract_bearer("") == ""
