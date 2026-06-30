"""Tests for main.py — rate-limit key function and MQTT lifespan branch."""

from __future__ import annotations

import asyncio
import importlib
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

_ENV = {
    "INFLUX_URL": "http://influxdb-test:8086",
    "INFLUX_TOKEN": "testtoken",
    "INFLUX_ORG": "mallard",
    "INFLUX_BUCKET": "metrics",
    "API_KEYS": "test-key-valid",
    "LOG_LEVEL": "DEBUG",
    "RATE_LIMIT": "1000/minute",
}


class TestRateLimitKeyFunction:
    def test_returns_api_key_header(self) -> None:
        from server.main import _get_key_for_rate_limit

        req = MagicMock()
        req.headers = {"X-API-Key": "abc123"}
        assert _get_key_for_rate_limit(req) == "abc123"

    def test_falls_back_to_client_ip_when_header_absent(self) -> None:
        from server.main import _get_key_for_rate_limit

        req = MagicMock()
        req.headers = MagicMock()
        req.headers.get = MagicMock(return_value=None)
        req.client.host = "10.0.0.1"
        assert _get_key_for_rate_limit(req) == "10.0.0.1"


class TestMqttLifespan:
    def test_mqtt_task_created_when_enabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        for k, v in _ENV.items():
            monkeypatch.setenv(k, v)
        monkeypatch.setenv("MQTT_ENABLED", "true")
        monkeypatch.setenv("MQTT_CREDENTIALS", "test-mqtt-password")

        import server.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)

        mock_influx = MagicMock()
        mock_influx.write_api.return_value = MagicMock()
        mock_influx.ping.return_value = True

        async def _noop_mqtt(settings, write_api, verifier) -> None:
            try:
                await asyncio.sleep(3600)
            except asyncio.CancelledError:
                return

        with (
            patch("server.influx.make_client", return_value=mock_influx),
            patch("server.mqtt.run_mqtt_broker", _noop_mqtt),
        ):
            import server.main as main_module

            importlib.reload(main_module)
            app = main_module.create_app()

            with TestClient(app, raise_server_exceptions=False):
                assert hasattr(app.state, "mqtt_task")
                assert not app.state.mqtt_task.done()
