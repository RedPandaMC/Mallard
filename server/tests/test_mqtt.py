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
    return s


@pytest.fixture()
def static_verifier():
    """StaticCredentialVerifier with MQTT password 'secret' → label 'test-client'."""
    from src.credential_verifier import StaticCredentialVerifier

    mock_settings = MagicMock()
    mock_settings.hashed_api_keys = {}
    mock_settings.hashed_mqtt_credentials = {
        hashlib.sha256(b"secret").hexdigest(): "test-client"
    }
    return StaticCredentialVerifier(mock_settings)


@pytest.fixture()
def empty_verifier():
    """StaticCredentialVerifier with no credentials configured."""
    from src.credential_verifier import StaticCredentialVerifier

    mock_settings = MagicMock()
    mock_settings.hashed_api_keys = {}
    mock_settings.hashed_mqtt_credentials = {}
    return StaticCredentialVerifier(mock_settings)


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

    def test_valid_payload_with_source(self, mock_write_api, settings) -> None:
        from src.mqtt import _handle_message

        _handle_message(_make_message(VALID_JSON), mock_write_api, settings, source="team-alpha")
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

    async def test_rejects_missing_password(self, static_verifier) -> None:
        from src.mqtt import _ctx

        _ctx["verifier"] = static_verifier
        plugin = self._make_plugin()
        session = MagicMock()
        session.password = None

        result = await plugin.authenticate(session=session)
        assert result is False

    async def test_rejects_empty_password(self, static_verifier) -> None:
        from src.mqtt import _ctx

        _ctx["verifier"] = static_verifier
        plugin = self._make_plugin()
        session = MagicMock()
        session.password = ""

        result = await plugin.authenticate(session=session)
        assert result is False

    async def test_rejects_wrong_password(self, static_verifier) -> None:
        from src.mqtt import _ctx

        _ctx["verifier"] = static_verifier
        plugin = self._make_plugin()
        session = MagicMock()
        session.password = "wrong-password"

        result = await plugin.authenticate(session=session)
        assert result is False

    async def test_accepts_valid_credential(self, static_verifier) -> None:
        from src.mqtt import _ctx

        _ctx["verifier"] = static_verifier
        _ctx["client_labels"] = {}
        plugin = self._make_plugin()
        session = MagicMock()
        session.password = "secret"
        session.client_id = "client-1"

        result = await plugin.authenticate(session=session)
        assert result is True
        assert _ctx["client_labels"]["client-1"] == "test-client"

    async def test_rejects_when_no_credentials_configured(self, empty_verifier) -> None:
        from src.mqtt import _ctx

        _ctx["verifier"] = empty_verifier
        plugin = self._make_plugin()
        session = MagicMock()
        session.password = "any-password"

        result = await plugin.authenticate(session=session)
        assert result is False

    async def test_client_label_stored_on_authenticate(self, static_verifier) -> None:
        from src.mqtt import _ctx

        _ctx["verifier"] = static_verifier
        _ctx["client_labels"] = {}
        plugin = self._make_plugin()
        session = MagicMock()
        session.password = "secret"
        session.client_id = "my-device"

        await plugin.authenticate(session=session)
        assert _ctx["client_labels"].get("my-device") == "test-client"


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
        _ctx["client_labels"] = {"test-client": "team-alpha"}
        plugin = self._make_plugin()

        await plugin.on_broker_message_received(
            client_id="test-client", message=_make_message(VALID_JSON)
        )
        mock_write_api.write.assert_called_once()

    async def test_none_message_does_not_crash(self, mock_write_api, settings) -> None:
        from src.mqtt import _ctx

        _ctx["write_api"] = mock_write_api
        _ctx["settings"] = settings
        _ctx["client_labels"] = {}
        plugin = self._make_plugin()

        await plugin.on_broker_message_received(client_id="test-client", message=None)
        mock_write_api.write.assert_not_called()

    async def test_invalid_json_does_not_crash(self, mock_write_api, settings) -> None:
        from src.mqtt import _ctx

        _ctx["write_api"] = mock_write_api
        _ctx["settings"] = settings
        _ctx["client_labels"] = {}
        plugin = self._make_plugin()

        await plugin.on_broker_message_received(
            client_id="test-client", message=_make_message(b"not json {{")
        )
        mock_write_api.write.assert_not_called()

    async def test_source_defaults_to_unknown_for_unlabeled_client(
        self, mock_write_api, settings
    ) -> None:
        from src.mqtt import _ctx

        _ctx["write_api"] = mock_write_api
        _ctx["settings"] = settings
        _ctx["client_labels"] = {}  # no label for this client
        plugin = self._make_plugin()

        await plugin.on_broker_message_received(
            client_id="unknown-client", message=_make_message(VALID_JSON)
        )
        mock_write_api.write.assert_called_once()

    async def test_disconnect_cleans_label(self, mock_write_api, settings) -> None:
        from src.mqtt import _ctx

        _ctx["write_api"] = mock_write_api
        _ctx["settings"] = settings
        _ctx["client_labels"] = {"dc-client": "some-label"}
        plugin = self._make_plugin()

        await plugin.on_broker_client_disconnected(client_id="dc-client")
        assert "dc-client" not in _ctx["client_labels"]

    async def test_disconnect_missing_client_does_not_crash(self, mock_write_api, settings) -> None:
        from src.mqtt import _ctx

        _ctx["write_api"] = mock_write_api
        _ctx["settings"] = settings
        _ctx["client_labels"] = {}
        plugin = self._make_plugin()

        # Should not raise
        await plugin.on_broker_client_disconnected(client_id="nonexistent")


class TestMqttBrokerLifecycle:
    """Test run_mqtt_broker starts cleanly and shuts down on cancellation."""

    async def test_starts_and_stops_on_cancel(self, settings, mock_write_api, static_verifier) -> None:
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
            await run_mqtt_broker(settings, mock_write_api, static_verifier)

        mock_broker.start.assert_called_once()
        mock_broker.shutdown.assert_called_once()
