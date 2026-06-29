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

    def test_health_influx_down(self, client: TestClient, monkeypatch) -> None:
        import src.influx as influx_module

        async def _ping_false(_client):
            return False

        monkeypatch.setattr(influx_module, "ping_influx", _ping_false)
        response = client.get("/health")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "degraded"
        assert body["influx"] == "error"
