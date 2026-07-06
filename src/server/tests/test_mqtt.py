"""Tests for the embedded MQTT broker, auth plugin, and message handler."""

from __future__ import annotations

import asyncio
import json
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import server.mqtt as mqtt_module
from server.mqtt import MQTT_SOURCE, BrokerContext
from server.rate_limit import SlidingWindowLimiter


@pytest.fixture()
def mock_write_api() -> MagicMock:
    api = MagicMock()
    api.write = AsyncMock(return_value=True)
    return api


@pytest.fixture()
def settings() -> MagicMock:
    s = MagicMock()
    s.influx_bucket = "metrics"
    s.influx_org = "mallard"
    s.mqtt_port = 8083
    s.mqtt_topic_prefix = "mallard/"
    s.rate_limit = "1000/minute"
    return s


def _limiter(spec: str = "1000/minute") -> SlidingWindowLimiter:
    return SlidingWindowLimiter.from_string(spec)


@pytest.fixture()
def static_verifier():
    """StaticCredentialVerifier with shared MQTT password 'secret'."""
    from server.credential_verifier import StaticCredentialVerifier

    mock_settings = MagicMock()
    mock_settings.hashed_api_keys = {}
    mock_settings.mqtt_password = "secret"
    mock_settings.parsed_cert_labels = {}
    return StaticCredentialVerifier(mock_settings)


@pytest.fixture()
def empty_verifier():
    """StaticCredentialVerifier with no credentials configured."""
    from server.credential_verifier import StaticCredentialVerifier

    mock_settings = MagicMock()
    mock_settings.hashed_api_keys = {}
    mock_settings.mqtt_password = ""
    mock_settings.parsed_cert_labels = {}
    return StaticCredentialVerifier(mock_settings)


def _ctx(settings, write_api, verifier, limiter=None) -> BrokerContext:
    return BrokerContext(
        settings=settings,
        write_api=write_api,
        verifier=verifier,
        limiter=limiter or _limiter(),
    )


@pytest.fixture()
def broker_ctx(settings, mock_write_api, static_verifier, monkeypatch):
    """Install a BrokerContext for the plugin under test; restored afterwards."""
    ctx = _ctx(settings, mock_write_api, static_verifier)
    monkeypatch.setattr(mqtt_module, "_broker_ctx", ctx)
    return ctx


def _make_message(data: bytes | str, topic: str = "mallard/metrics") -> MagicMock:
    msg = MagicMock()
    msg.data = data if isinstance(data, bytes) else data.encode()
    msg.topic = topic
    return msg


VALID_JSON = json.dumps({
    "instance_id": "abc123",
    "schema_version": 3,
    "ts": 1_700_000_000_000,
    "tz_offset_minutes": 120,
    "mtd_budget_pct": 42.0,
    "mtd_credits": 100.0,
    "mtd_cost_usd": 3.50,
    "today_credits": 10.0,
    "today_cost_usd": 0.35,
    "active_models": ["claude-sonnet-4-5"],
    "top_model": "claude-sonnet-4-5",
})


class TestMqttHandleMessage:
    async def test_valid_payload_calls_write(self, mock_write_api, settings, static_verifier) -> None:
        from server.mqtt import _handle_message

        await _handle_message(_make_message(VALID_JSON), "c1", _ctx(settings, mock_write_api, static_verifier))
        mock_write_api.write.assert_called_once()

    async def test_valid_payload_with_source(self, mock_write_api, settings, static_verifier) -> None:
        from server.mqtt import _handle_message

        await _handle_message(
            _make_message(VALID_JSON), "c1", _ctx(settings, mock_write_api, static_verifier), source="team-alpha"
        )
        mock_write_api.write.assert_called_once()

    async def test_invalid_json_does_not_crash(self, mock_write_api, settings, static_verifier) -> None:
        from server.mqtt import _handle_message

        await _handle_message(_make_message(b"not { valid json"), "c1", _ctx(settings, mock_write_api, static_verifier))
        mock_write_api.write.assert_not_called()

    async def test_schema_mismatch_does_not_crash(self, mock_write_api, settings, static_verifier) -> None:
        from server.mqtt import _handle_message

        bad = json.dumps({"completely": "wrong", "shape": True})
        await _handle_message(_make_message(bad), "c1", _ctx(settings, mock_write_api, static_verifier))
        mock_write_api.write.assert_not_called()

    async def test_write_failure_does_not_crash(self, mock_write_api, settings, static_verifier) -> None:
        from server.mqtt import _handle_message

        mock_write_api.write = AsyncMock(side_effect=RuntimeError("influxdb down"))
        await _handle_message(_make_message(VALID_JSON), "c1", _ctx(settings, mock_write_api, static_verifier))

    async def test_out_of_scope_topic_is_dropped(self, mock_write_api, settings, static_verifier) -> None:
        from server.mqtt import _handle_message

        msg = _make_message(VALID_JSON, topic="somethingelse/x")
        await _handle_message(msg, "c1", _ctx(settings, mock_write_api, static_verifier))
        mock_write_api.write.assert_not_called()

    async def test_oversized_message_is_dropped(self, mock_write_api, settings, static_verifier) -> None:
        from server.mqtt import _handle_message

        huge = b"x" * (64 * 1024 + 1)
        await _handle_message(_make_message(huge), "c1", _ctx(settings, mock_write_api, static_verifier))
        mock_write_api.write.assert_not_called()

    async def test_rate_limit_drops_excess_messages(self, mock_write_api, settings, static_verifier) -> None:
        from server.mqtt import _handle_message

        ctx = _ctx(settings, mock_write_api, static_verifier, limiter=_limiter("1/minute"))
        await _handle_message(_make_message(VALID_JSON), "c1", ctx)
        await _handle_message(_make_message(VALID_JSON), "c1", ctx)  # second exceeds 1/min for c1
        assert mock_write_api.write.call_count == 1

    async def test_rate_limit_is_per_client(self, mock_write_api, settings, static_verifier) -> None:
        from server.mqtt import _handle_message

        ctx = _ctx(settings, mock_write_api, static_verifier, limiter=_limiter("1/minute"))
        await _handle_message(_make_message(VALID_JSON), "c1", ctx)
        await _handle_message(_make_message(VALID_JSON), "c2", ctx)  # different client, still allowed
        assert mock_write_api.write.call_count == 2


class TestMallardAuthPlugin:
    """Test the amqtt auth plugin directly by instantiating it with a minimal context."""

    def _make_plugin(self):
        from server.mqtt import _MallardAuthPlugin

        ctx = MagicMock()
        ctx.config = _MallardAuthPlugin.Config()
        ctx.logger = logging.getLogger("test.auth")
        return _MallardAuthPlugin(ctx)

    async def test_rejects_missing_password(self, broker_ctx) -> None:
        plugin = self._make_plugin()
        session = MagicMock()
        session.password = None

        assert await plugin.authenticate(session=session) is False

    async def test_rejects_empty_password(self, broker_ctx) -> None:
        plugin = self._make_plugin()
        session = MagicMock()
        session.password = ""

        assert await plugin.authenticate(session=session) is False

    async def test_rejects_wrong_password(self, broker_ctx) -> None:
        plugin = self._make_plugin()
        session = MagicMock()
        session.password = "wrong-password"

        assert await plugin.authenticate(session=session) is False

    async def test_accepts_shared_password(self, broker_ctx) -> None:
        plugin = self._make_plugin()
        session = MagicMock()
        session.password = "secret"
        session.client_id = "client-1"

        assert await plugin.authenticate(session=session) is True

    async def test_rejects_when_no_password_configured(
        self, settings, mock_write_api, empty_verifier, monkeypatch
    ) -> None:
        ctx = _ctx(settings, mock_write_api, empty_verifier)
        monkeypatch.setattr(mqtt_module, "_broker_ctx", ctx)
        plugin = self._make_plugin()
        session = MagicMock()
        session.password = "any-password"

        assert await plugin.authenticate(session=session) is False

    async def test_rejects_without_broker_context(self, monkeypatch) -> None:
        monkeypatch.setattr(mqtt_module, "_broker_ctx", None)
        plugin = self._make_plugin()
        session = MagicMock()
        session.password = "secret"

        assert await plugin.authenticate(session=session) is False

    async def test_rejects_when_verifier_raises(
        self, settings, mock_write_api, monkeypatch
    ) -> None:
        raising_verifier = MagicMock()
        raising_verifier.verify_mqtt_password = AsyncMock(side_effect=RuntimeError("vault down"))
        ctx = _ctx(settings, mock_write_api, raising_verifier)
        monkeypatch.setattr(mqtt_module, "_broker_ctx", ctx)
        plugin = self._make_plugin()
        session = MagicMock()
        session.password = "secret"

        assert await plugin.authenticate(session=session) is False


class TestMallardMessagePlugin:
    """Test the amqtt message plugin directly."""

    def _make_plugin(self):
        from server.mqtt import _MallardMessagePlugin

        ctx = MagicMock()
        ctx.config = _MallardMessagePlugin.Config()
        ctx.logger = logging.getLogger("test.msg")
        return _MallardMessagePlugin(ctx)

    async def test_valid_message_calls_write(self, broker_ctx, mock_write_api) -> None:
        plugin = self._make_plugin()

        await plugin.on_broker_message_received(
            client_id="test-client", message=_make_message(VALID_JSON)
        )
        mock_write_api.write.assert_called_once()

    async def test_all_messages_tagged_source_mqtt(self, broker_ctx, mock_write_api) -> None:
        plugin = self._make_plugin()

        with patch("server.mqtt.write_payload", new=AsyncMock()) as write_mock:
            await plugin.on_broker_message_received(
                client_id="whoever", message=_make_message(VALID_JSON)
            )
        assert write_mock.call_args.kwargs["source"] == MQTT_SOURCE

    async def test_none_message_does_not_crash(self, broker_ctx, mock_write_api) -> None:
        plugin = self._make_plugin()

        await plugin.on_broker_message_received(client_id="test-client", message=None)
        mock_write_api.write.assert_not_called()

    async def test_invalid_json_does_not_crash(self, broker_ctx, mock_write_api) -> None:
        plugin = self._make_plugin()

        await plugin.on_broker_message_received(
            client_id="test-client", message=_make_message(b"not json {{")
        )
        mock_write_api.write.assert_not_called()

    async def test_message_without_broker_context_does_not_crash(
        self, mock_write_api, monkeypatch
    ) -> None:
        monkeypatch.setattr(mqtt_module, "_broker_ctx", None)
        plugin = self._make_plugin()

        await plugin.on_broker_message_received(
            client_id="test-client", message=_make_message(VALID_JSON)
        )
        mock_write_api.write.assert_not_called()


class TestMqttBrokerLifecycle:
    """Test run_mqtt_broker starts cleanly and shuts down on cancellation."""

    async def test_starts_and_stops_on_cancel(self, settings, mock_write_api, static_verifier) -> None:
        from server.mqtt import run_mqtt_broker

        mock_broker = AsyncMock()
        mock_broker.start = AsyncMock()
        mock_broker.shutdown = AsyncMock()

        mock_event_instance = MagicMock()
        mock_event_instance.wait = AsyncMock(side_effect=asyncio.CancelledError())

        with (
            patch("server.mqtt.Broker", return_value=mock_broker),
            patch("server.mqtt.asyncio.Event", return_value=mock_event_instance),
        ):
            await run_mqtt_broker(settings, mock_write_api, static_verifier)

        mock_broker.start.assert_called_once()
        mock_broker.shutdown.assert_called_once()
        assert mqtt_module._broker_ctx is None  # cleared on shutdown
