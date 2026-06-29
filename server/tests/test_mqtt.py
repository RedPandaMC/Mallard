"""Tests for the embedded MQTT broker, auth plugin, and message handler."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.fixture()
def mock_write_api() -> MagicMock:
    return MagicMock()


@pytest.fixture()
def settings(monkeypatch) -> MagicMock:
    s = MagicMock()
    s.influx_bucket = "metrics"
    s.influx_org = "mallard"
    s.mqtt_port = 8083
    s.hashed_mqtt_credentials = {hashlib.sha256(b"secret").hexdigest()}
    return s


def _make_message(data: bytes | str) -> MagicMock:
    msg = MagicMock()
    msg.data = data if isinstance(data, bytes) else data.encode()
    msg.topic = "mallard/metrics"
    return msg


VALID_JSON = json.dumps({
    "instance_id": "abc123",
    "schema_version": 2,
    "ts": 1_700_000_000_000,
    "credits_velocity_per_hour": 1.5,
    "mtd_budget_pct": 42.0,
    "mtd_credits": 100.0,
    "mtd_cost_usd": 3.50,
    "today_credits": 10.0,
    "today_cost_usd": 0.35,
    "active_models": ["claude-sonnet-4-5"],
    "top_model": "claude-sonnet-4-5",
})


class TestMqttHandleMessage:
    def test_valid_payload_calls_write(self, mock_write_api, settings) -> None:
        from src.mqtt import _handle_message

        _handle_message(_make_message(VALID_JSON), mock_write_api, settings)
        mock_write_api.write.assert_called_once()

    def test_invalid_json_does_not_crash(self, mock_write_api, settings) -> None:
        from src.mqtt import _handle_message

        _handle_message(_make_message(b"not { valid json"), mock_write_api, settings)
        mock_write_api.write.assert_not_called()

    def test_schema_mismatch_does_not_crash(self, mock_write_api, settings) -> None:
        from src.mqtt import _handle_message

        bad = json.dumps({"completely": "wrong", "shape": True})
        _handle_message(_make_message(bad), mock_write_api, settings)
        mock_write_api.write.assert_not_called()

    def test_write_failure_does_not_crash(self, mock_write_api, settings) -> None:
        from src.mqtt import _handle_message

        mock_write_api.write.side_effect = RuntimeError("influxdb down")
        _handle_message(_make_message(VALID_JSON), mock_write_api, settings)


class TestMallardAuthPlugin:
    """Test the amqtt auth plugin directly by instantiating it with a minimal context."""

    def _make_plugin(self):
        from src.mqtt import _MallardAuthPlugin

        ctx = MagicMock()
        ctx.config = _MallardAuthPlugin.Config()
        ctx.logger = logging.getLogger("test.auth")
        return _MallardAuthPlugin(ctx)

    async def test_rejects_missing_password(self, settings) -> None:
        from src.mqtt import _ctx

        _ctx["settings"] = settings
        plugin = self._make_plugin()
        session = MagicMock()
        session.password = None

        result = await plugin.authenticate(session=session)
        assert result is False

    async def test_rejects_empty_password(self, settings) -> None:
        from src.mqtt import _ctx

        _ctx["settings"] = settings
        plugin = self._make_plugin()
        session = MagicMock()
        session.password = ""

        result = await plugin.authenticate(session=session)
        assert result is False

    async def test_rejects_wrong_password(self, settings) -> None:
        from src.mqtt import _ctx

        _ctx["settings"] = settings
        plugin = self._make_plugin()
        session = MagicMock()
        session.password = "wrong-password"

        result = await plugin.authenticate(session=session)
        assert result is False

    async def test_accepts_valid_credential(self, settings) -> None:
        from src.mqtt import _ctx

        _ctx["settings"] = settings
        plugin = self._make_plugin()
        session = MagicMock()
        session.password = "secret"

        result = await plugin.authenticate(session=session)
        assert result is True

    async def test_rejects_when_no_credentials_configured(self) -> None:
        from src.mqtt import _ctx

        s = MagicMock()
        s.hashed_mqtt_credentials = set()  # no credentials configured
        _ctx["settings"] = s
        plugin = self._make_plugin()
        session = MagicMock()
        session.password = "any-password"

        result = await plugin.authenticate(session=session)
        assert result is False


class TestMallardMessagePlugin:
    """Test the amqtt message plugin directly."""

    def _make_plugin(self):
        from src.mqtt import _MallardMessagePlugin

        ctx = MagicMock()
        ctx.config = _MallardMessagePlugin.Config()
        ctx.logger = logging.getLogger("test.msg")
        return _MallardMessagePlugin(ctx)

    async def test_valid_message_calls_write(self, mock_write_api, settings) -> None:
        from src.mqtt import _ctx

        _ctx["write_api"] = mock_write_api
        _ctx["settings"] = settings
        plugin = self._make_plugin()

        await plugin.on_broker_message_received(
            client_id="test-client", message=_make_message(VALID_JSON)
        )
        mock_write_api.write.assert_called_once()

    async def test_none_message_does_not_crash(self, mock_write_api, settings) -> None:
        from src.mqtt import _ctx

        _ctx["write_api"] = mock_write_api
        _ctx["settings"] = settings
        plugin = self._make_plugin()

        await plugin.on_broker_message_received(client_id="test-client", message=None)
        mock_write_api.write.assert_not_called()

    async def test_invalid_json_does_not_crash(self, mock_write_api, settings) -> None:
        from src.mqtt import _ctx

        _ctx["write_api"] = mock_write_api
        _ctx["settings"] = settings
        plugin = self._make_plugin()

        await plugin.on_broker_message_received(
            client_id="test-client", message=_make_message(b"not json {{")
        )
        mock_write_api.write.assert_not_called()


class TestMqttBrokerLifecycle:
    """Test run_mqtt_broker starts cleanly and shuts down on cancellation."""

    async def test_starts_and_stops_on_cancel(self, settings, mock_write_api) -> None:
        from src.mqtt import run_mqtt_broker

        mock_broker = AsyncMock()
        mock_broker.start = AsyncMock()
        mock_broker.shutdown = AsyncMock()

        mock_event_instance = MagicMock()
        mock_event_instance.wait = AsyncMock(side_effect=asyncio.CancelledError())

        with (
            patch("src.mqtt.Broker", return_value=mock_broker),
            patch("src.mqtt.asyncio.Event", return_value=mock_event_instance),
        ):
            await run_mqtt_broker(settings, mock_write_api)

        mock_broker.start.assert_called_once()
        mock_broker.shutdown.assert_called_once()
