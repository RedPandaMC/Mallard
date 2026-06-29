"""Tests for POST /api/v1/ingest."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

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
        from src.routers.ingest import ingest
        from src.schemas import IngestPayload

        mock_request = MagicMock()
        mock_request.headers.get = MagicMock(return_value=str(64 * 1024 + 1))

        result = await ingest(
            payload=IngestPayload(**valid_payload),
            request=mock_request,
            key_hash="testhash",
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
