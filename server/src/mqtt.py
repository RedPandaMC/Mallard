"""Embedded MQTT broker: accepts metric payloads via WebSocket and writes to InfluxDB."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

from amqtt.broker import Broker
from amqtt.plugins.base import BaseAuthPlugin, BasePlugin
from amqtt.session import Session
from pydantic import ValidationError

from .influx import write_payload
from .schemas import IngestPayload

if TYPE_CHECKING:
    from influxdb_client.client.write_api import WriteApi

    from .config import Settings

logger = logging.getLogger(__name__)

# Shared at module level so amqtt plugin instances (created by the broker) can reach runtime objects.
_ctx: dict = {}


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def _constant_time_match(candidate: str, hashed_keys: set[str]) -> bool:
    return any(hmac.compare_digest(candidate, h) for h in hashed_keys)


class _MallardAuthPlugin(BaseAuthPlugin):
    """Validates MQTT passwords against hashed_mqtt_credentials (independent of HTTP API keys)."""

    @dataclass
    class Config:
        pass

    async def authenticate(self, *, session: Session) -> bool | None:
        password = session.password
        if not password:
            return False
        return _constant_time_match(_hash_key(password), _ctx["settings"].hashed_mqtt_credentials)


class _MallardMessagePlugin(BasePlugin):
    """Receives published MQTT messages and writes them to InfluxDB."""

    @dataclass
    class Config:
        pass

    async def on_broker_message_received(self, *, client_id: str = "", message=None, **kwargs) -> None:
        if message is None:
            return
        _handle_message(message, _ctx["write_api"], _ctx["settings"])


def _handle_message(message, write_api: "WriteApi", settings: "Settings") -> None:
    try:
        data = json.loads(message.data)
        payload = IngestPayload.model_validate(data)
        write_payload(
            write_api=write_api,
            bucket=settings.influx_bucket,
            org=settings.influx_org,
            payload=payload,
        )
        logger.debug("MQTT: ingested instance=%s", payload.instance_id)
    except (json.JSONDecodeError, ValidationError) as exc:
        logger.warning("MQTT: rejected message: %s", exc)
    except Exception as exc:
        logger.error("MQTT: write failed: %s", exc)


async def run_mqtt_broker(settings: "Settings", write_api: "WriteApi") -> None:
    """Start the embedded amqtt broker on the configured WebSocket port; blocks until cancelled."""
    _ctx["settings"] = settings
    _ctx["write_api"] = write_api

    config = {
        "listeners": {
            "default": {
                "type": "ws",
                "bind": f"0.0.0.0:{settings.mqtt_port}",
            }
        },
        "plugins": {
            f"{__name__}._MallardAuthPlugin": {},
            f"{__name__}._MallardMessagePlugin": {},
        },
    }
    broker = Broker(config=config)
    try:
        await broker.start()
        logger.info("MQTT broker started on ws://0.0.0.0:%d", settings.mqtt_port)
        await asyncio.Event().wait()
    except asyncio.CancelledError:
        pass
    finally:
        await broker.shutdown()
        logger.info("MQTT broker stopped")
