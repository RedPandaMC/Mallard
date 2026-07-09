"""InfluxDB v2 client factory and write helper for the v1 event stream."""

from __future__ import annotations

import json
import logging
import re
from typing import TYPE_CHECKING

from influxdb_client import Point, WritePrecision
from influxdb_client.client.influxdb_client_async import InfluxDBClientAsync

from .config import Settings
from .normalize import NormalizedBatch

if TYPE_CHECKING:
    from influxdb_client.client.write_api_async import WriteApiAsync

logger = logging.getLogger(__name__)

_MEASUREMENT = "mallard_events"

# Tag values are indexed; restrict to a bounded, sanitised character set so a
# hostile model/surface/language string can't smuggle line-protocol syntax or
# explode cardinality with unbounded junk.
_TAG_VALUE_RE = re.compile(r"[^A-Za-z0-9._@ /-]+")
_FIELD_KEY_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _tag_value(value: str) -> str:
    return _TAG_VALUE_RE.sub("_", value)[:64] or "unknown"


def _field_key(prefix: str, key: str) -> str:
    safe = _FIELD_KEY_RE.sub("_", key)[:64] or "unknown"
    return f"{prefix}_{safe}"


def make_client(settings: Settings) -> InfluxDBClientAsync:
    """Create and return an async InfluxDB v2 client configured from *settings*.

    The async client keeps blocking network I/O off the event loop, so a slow
    InfluxDB can't stall concurrent ingest requests, health checks, or the MQTT
    handler. Must be constructed inside a running event loop (its aiohttp session
    is created eagerly) — call it from the FastAPI lifespan, not module scope.
    """
    return InfluxDBClientAsync(
        url=settings.influx_url,
        token=settings.influx_token,
        org=settings.influx_org,
    )


async def write_payload(
    write_api: "WriteApiAsync",
    bucket: str,
    org: str,
    batch: NormalizedBatch,
    source: str = "unknown",
) -> None:
    """Write one InfluxDB point per event in the batch (single write call).

    Tags carry the queryable dimensions: `source` is the server-side credential
    label (who sent it — API key label, cert CN, or JWT claim; it exists only
    here), while `connector`/`model`/`surface`/`language`/`repo`/`branch` are
    calculated on the edge and shipped with each event; the server only
    aggregates them. The event timestamp is the point
    timestamp, so the series reflects when the usage happened, not when the
    batch arrived. The client event id is written as a field — not a tag, to
    keep cardinality bounded — so duplicates from retries can be audited.
    """
    points: list[Point] = []
    for e in batch.events:
        point = (
            Point(_MEASUREMENT)
            .tag("instance_id", batch.instance_id or "unknown")
            .tag("schema_version", str(batch.schema_version))
            .tag("source", source)
            .tag("connector", _tag_value(e.connector))
            .tag("model", _tag_value(e.model))
            .tag("surface", _tag_value(e.surface))
            .tag("language", _tag_value(e.language) if e.language else "unknown")
            .tag("repo", _tag_value(e.repo) if e.repo else "unattributed")
            .tag("branch", _tag_value(e.branch) if e.branch else "unknown")
            .field("credits", float(e.credits))
            .field("cost_usd", float(e.cost_usd))
            .field("estimated", bool(e.estimated))
            .field("count", 1)
        )
        for name, value in e.tokens.items():
            point = point.field(name, int(value))
        for key, value in e.cost_by_category.items():
            point = point.field(_field_key("cbc", key), float(value))
        if e.attribution:
            point = point.tag("attribution", _tag_value(e.attribution))
        if e.event_id:
            point = point.field("event_id", e.event_id[:128])
        if e.extra:
            point = point.field("extra_json", json.dumps(e.extra, default=str))
        points.append(point.time(e.ts_ms, WritePrecision.MS))

    if not points:
        return

    logger.debug(
        "Writing %d InfluxDB points: measurement=%s instance=%s",
        len(points),
        _MEASUREMENT,
        batch.instance_id,
    )
    await write_api.write(bucket=bucket, org=org, record=points)


async def ping_influx(client: InfluxDBClientAsync) -> bool:
    """Return True if InfluxDB responds to a ping."""
    try:
        return await client.ping()
    except Exception as exc:
        logger.warning("InfluxDB ping failed: %s", exc)
        return False
