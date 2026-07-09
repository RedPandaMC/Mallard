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
from .rate_limit import SlidingWindowLimiter

if TYPE_CHECKING:
    from influxdb_client.client.write_api_async import WriteApiAsync

    from .config import Settings
    from .credential_verifier import CredentialVerifier

logger = logging.getLogger(__name__)

MQTT_SOURCE = "mqtt"

# Application-level per-message size cap. The 64 KB HTTP limit lives in the HTTP
# middleware only; without this, an authenticated MQTT client could publish a
# multi-megabyte blob straight through to InfluxDB.
_MAX_MQTT_BYTES = 64 * 1024


@dataclass
class BrokerContext:
    settings: "Settings"
    write_api: "WriteApiAsync"
    verifier: "CredentialVerifier"
    # Per-client sliding-window limiter so MQTT ingest can't bypass the
    # per-credential limiting the HTTP path enforces.
    limiter: SlidingWindowLimiter


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
        await _handle_message(message, client_id, _broker_ctx)


async def _handle_message(
    message,
    client_id: str,
    ctx: BrokerContext,
    source: str = MQTT_SOURCE,
) -> None:
    settings = ctx.settings

    # Topic scoping: only accept the metric-ingest topic namespace. Without this
    # every topic was treated as an ingest channel.
    topic = getattr(message, "topic", "") or ""
    if not topic.startswith(settings.mqtt_topic_prefix):
        logger.warning("MQTT: dropped message on out-of-scope topic %r", topic)
        return

    data = message.data or b""
    if len(data) > _MAX_MQTT_BYTES:
        logger.warning(
            "MQTT: dropped %d-byte message exceeding the %d-byte cap", len(data), _MAX_MQTT_BYTES
        )
        return

    # Per-client rate limit (falls back to the shared source label when the
    # broker doesn't supply a client id) so one client can't flood ingest.
    limiter_key = client_id or source
    if ctx.limiter.check(limiter_key) is not None:
        logger.warning("MQTT: rate limit exceeded for client %r", limiter_key)
        return

    try:
        data = json.loads(data)
        if not isinstance(data, dict):
            raise InvalidIngestPayload("MQTT payload must be a JSON object")
        batch = normalize_payload(data)
        await write_payload(
            write_api=ctx.write_api,
            bucket=settings.influx_bucket,
            org=settings.influx_org,
            batch=batch,
            source=source,
        )
        logger.debug(
            "MQTT: ingested instance=%s events=%d source=%s",
            batch.instance_id, len(batch.events), source,
        )
    except (json.JSONDecodeError, UnicodeDecodeError, InvalidIngestPayload) as exc:
        logger.warning("MQTT: rejected message: %s", exc)
    except Exception as exc:
        logger.error("MQTT: write failed: %s", exc)


async def run_mqtt_broker(
    settings: "Settings",
    write_api: "WriteApiAsync",
    verifier: "CredentialVerifier",
) -> None:
    """Start the embedded amqtt broker on the configured WebSocket port; blocks until cancelled."""
    global _broker_ctx
    _broker_ctx = BrokerContext(
        settings=settings,
        write_api=write_api,
        verifier=verifier,
        limiter=SlidingWindowLimiter.from_string(settings.rate_limit),
    )

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
