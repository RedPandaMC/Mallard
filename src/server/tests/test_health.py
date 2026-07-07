"""Tests for GET /health."""

from __future__ import annotations

from fastapi.testclient import TestClient


class TestHealthEndpoint:
    def test_health_ok(self, client: TestClient) -> None:
        # mock_influx_client.ping() returns True by default (see conftest)
        response = client.get("/health")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] in {"ok", "degraded"}
        assert "influx" in body

    def test_health_influx_up(self, client: TestClient) -> None:
        # Default fixture has ping() → True
        response = client.get("/health")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert body["influx"] == "pong"

    def test_health_influx_down_returns_503(self, client: TestClient, monkeypatch) -> None:
        # A hard-dependency outage must fail readiness (503) so the pod drains,
        # instead of the old always-200 behaviour that kept routing traffic to a
        # pod that 503s every ingest.
        import server.influx as influx_module

        async def _ping_false(_client):
            return False

        monkeypatch.setattr(influx_module, "ping_influx", _ping_false)
        response = client.get("/health")
        assert response.status_code == 503
        body = response.json()
        assert body["status"] == "degraded"
        assert body["influx"] == "error"

    def test_health_reports_secret_manager_and_rate_limiter(self, client: TestClient) -> None:
        body = client.get("/health").json()
        assert body["secret_manager"] == "ok"
        assert body["rate_limiter"] == "ok"

    def test_health_503_when_secret_manager_unreachable(self, client: TestClient) -> None:
        from unittest.mock import AsyncMock

        client.app.state.verifier.healthcheck = AsyncMock(return_value=False)
        response = client.get("/health")
        assert response.status_code == 503
        assert response.json()["secret_manager"] == "error"
