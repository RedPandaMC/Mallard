"""Tests for the MQTT subscriber message handler and reconnect loop."""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.fixture()
def mock_write_api() -> MagicMock:
    return MagicMock()


@pytest.fixture()
def settings(monkeypatch) -> MagicMock:
    s = MagicMock()
    s.mqtt_broker_url = "mqtt://localhost:1883"
    s.mqtt_topic = "mallard/metrics"
    s.mqtt_username = ""
    s.mqtt_password = ""
    s.influx_bucket = "metrics"
    s.influx_org = "mallard"
    return s


def _make_message(payload: bytes | str) -> MagicMock:
    msg = MagicMock()
    msg.payload = payload if isinstance(payload, bytes) else payload.encode()
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
        # Should log error but not propagate
        _handle_message(_make_message(VALID_JSON), mock_write_api, settings)


class TestMqttParseUrl:
    def test_mqtt_default_port(self) -> None:
        from src.mqtt import _parse_url

        host, port = _parse_url("mqtt://broker.example.com")
        assert host == "broker.example.com"
        assert port == 1883

    def test_mqtts_default_port(self) -> None:
        from src.mqtt import _parse_url

        host, port = _parse_url("mqtts://broker.example.com")
        assert host == "broker.example.com"
        assert port == 8883

    def test_explicit_port(self) -> None:
        from src.mqtt import _parse_url

        host, port = _parse_url("mqtt://mosquitto:1884")
        assert host == "mosquitto"
        assert port == 1884


class TestMqttSubscriberLoop:
    async def test_cancelled_exits_cleanly(self, mock_write_api, settings) -> None:
        from src.mqtt import run_mqtt_subscriber

        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(side_effect=asyncio.CancelledError())
        ctx.__aexit__ = AsyncMock(return_value=False)
        with patch("src.mqtt.aiomqtt.Client", return_value=ctx):
            await run_mqtt_subscriber(settings, mock_write_api)

    async def test_reconnects_on_connection_error(self, mock_write_api, settings) -> None:
        from src.mqtt import run_mqtt_subscriber

        call_count = 0

        async def _enter():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise OSError("connection refused")
            raise asyncio.CancelledError()

        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(side_effect=_enter)
        ctx.__aexit__ = AsyncMock(return_value=False)
        with patch("src.mqtt.aiomqtt.Client", return_value=ctx):
            with patch("src.mqtt.asyncio.sleep", AsyncMock()):
                await run_mqtt_subscriber(settings, mock_write_api)
        assert call_count == 2

    async def test_processes_message_then_exits(self, mock_write_api, settings) -> None:
        from src.mqtt import run_mqtt_subscriber

        msg = MagicMock()
        msg.payload = VALID_JSON.encode()
        msg.topic = "mallard/metrics"

        async def _messages():
            yield msg
            raise asyncio.CancelledError()

        mock_client = AsyncMock()
        mock_client.subscribe = AsyncMock()
        mock_client.messages = _messages()

        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=mock_client)
        ctx.__aexit__ = AsyncMock(return_value=False)
        with patch("src.mqtt.aiomqtt.Client", return_value=ctx):
            await run_mqtt_subscriber(settings, mock_write_api)

        mock_write_api.write.assert_called_once()
