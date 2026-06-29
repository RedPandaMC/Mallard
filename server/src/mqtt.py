"""MQTT subscriber: consumes mallard/metrics and writes to InfluxDB."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import TYPE_CHECKING
from urllib.parse import urlparse

import aiomqtt
from pydantic import ValidationError

from .influx import write_payload
from .schemas import IngestPayload

if TYPE_CHECKING:
    from influxdb_client.client.write_api import WriteApi

    from .config import Settings

logger = logging.getLogger(__name__)


def _parse_url(broker_url: str) -> tuple[str, int]:
    parsed = urlparse(broker_url)
    host = parsed.hostname or "localhost"
    port = parsed.port or (8883 if parsed.scheme in ("mqtts", "ssl") else 1883)
    return host, port


async def run_mqtt_subscriber(settings: "Settings", write_api: "WriteApi") -> None:
    """Long-running async task that subscribes to the metrics topic and reconnects on loss."""
    host, port = _parse_url(settings.mqtt_broker_url)

    while True:
        try:
            async with aiomqtt.Client(
                hostname=host,
                port=port,
                username=settings.mqtt_username or None,
                password=settings.mqtt_password or None,
            ) as client:
                await client.subscribe(settings.mqtt_topic)
                logger.info("MQTT: subscribed to %s on %s:%d", settings.mqtt_topic, host, port)
                async for message in client.messages:
                    _handle_message(message, write_api, settings)
        except asyncio.CancelledError:
            logger.info("MQTT subscriber cancelled")
            return
        except Exception as exc:
            logger.warning("MQTT connection lost (%s) — retrying in 5s", exc)
            await asyncio.sleep(5)


def _handle_message(message: aiomqtt.Message, write_api: "WriteApi", settings: "Settings") -> None:
    try:
        data = json.loads(message.payload)
        payload = IngestPayload.model_validate(data)
        write_payload(
            write_api=write_api,
            bucket=settings.influx_bucket,
            org=settings.influx_org,
            payload=payload,
        )
        logger.debug("MQTT: ingested instance=%s", payload.instance_id)
    except (json.JSONDecodeError, ValidationError) as exc:
        logger.warning("MQTT: rejected message on %s: %s", message.topic, exc)
    except Exception as exc:
        logger.error("MQTT: write failed for message on %s: %s", message.topic, exc)
