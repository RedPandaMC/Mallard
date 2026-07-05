"""Embedded MQTT broker: accepts metric payloads via WebSocket and writes to InfluxDB.

Auth model: one shared broker password verified via the CredentialVerifier;
everything ingested over MQTT is tagged source='mqtt'. Per-credential labels
exist only for API keys and cert CNs (see credential_verifier.py), so there is
no per-client label bookkeeping here.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

from amqtt.broker import Broker
from amqtt.plugins.base import BaseAuthPlugin, BasePlugin
from amqtt.session import Session

from .influx import write_payload
from .normalize import InvalidIngestPayload, normalize_payload

if TYPE_CHECKING:
    from influxdb_client.client.write_api import WriteApi

    from .config import Settings
    from .credential_verifier import CredentialVerifier

logger = logging.getLogger(__name__)

MQTT_SOURCE = "mqtt"


@dataclass
class BrokerContext:
    settings: "Settings"
    write_api: "WriteApi"
    verifier: "CredentialVerifier"


# amqtt instantiates plugins from their dotted module path, so runtime objects
# can only reach them through module state. A single typed context object
# (set once per broker run) replaces the previous untyped dict.
_broker_ctx: BrokerContext | None = None


class _MallardAuthPlugin(BaseAuthPlugin):
    """Validates the shared MQTT password via the configured CredentialVerifier."""

    @dataclass
    class Config:
        pass

    async def authenticate(self, *, session: Session) -> bool | None:
        if _broker_ctx is None:
            logger.error("MQTT auth invoked before broker context was initialised")
            return False
        password = session.password
        if not password:
            return False
        try:
            return await _broker_ctx.verifier.verify_mqtt_password(password)
        except Exception as exc:
            # Secret manager unreachable with no cache — refuse the connection
            # rather than crashing the broker.
            logger.error("MQTT auth: credential verification unavailable: %s", exc)
            return False


class _MallardMessagePlugin(BasePlugin):
    """Receives published MQTT messages and writes them to InfluxDB."""

    @dataclass
    class Config:
        pass

    async def on_broker_message_received(self, *, client_id: str = "", message=None, **kwargs) -> None:
        if message is None or _broker_ctx is None:
            return
        _handle_message(message, _broker_ctx.write_api, _broker_ctx.settings, MQTT_SOURCE)


def _handle_message(
    message,
    write_api: "WriteApi",
    settings: "Settings",
    source: str = MQTT_SOURCE,
) -> None:
    try:
        data = json.loads(message.data)
        if not isinstance(data, dict):
            raise InvalidIngestPayload("MQTT payload must be a JSON object")
        metric = normalize_payload(data)
        write_payload(
            write_api=write_api,
            bucket=settings.influx_bucket,
            org=settings.influx_org,
            metric=metric,
            source=source,
        )
        logger.debug("MQTT: ingested instance=%s source=%s", metric.instance_id, source)
    except (json.JSONDecodeError, UnicodeDecodeError, InvalidIngestPayload) as exc:
        logger.warning("MQTT: rejected message: %s", exc)
    except Exception as exc:
        logger.error("MQTT: write failed: %s", exc)


async def run_mqtt_broker(
    settings: "Settings",
    write_api: "WriteApi",
    verifier: "CredentialVerifier",
) -> None:
    """Start the embedded amqtt broker on the configured WebSocket port; blocks until cancelled."""
    global _broker_ctx
    _broker_ctx = BrokerContext(settings=settings, write_api=write_api, verifier=verifier)

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
        _broker_ctx = None
        logger.info("MQTT broker stopped")
