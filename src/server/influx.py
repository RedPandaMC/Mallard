"""InfluxDB v2 client factory and write helper."""

from __future__ import annotations

import json
import logging
import re
from typing import TYPE_CHECKING

from influxdb_client import Point, WritePrecision
from influxdb_client.client.influxdb_client_async import InfluxDBClientAsync

from .config import Settings
from .normalize import NormalizedMetric

if TYPE_CHECKING:
    from influxdb_client.client.write_api_async import WriteApiAsync

logger = logging.getLogger(__name__)

_MEASUREMENT = "mallard_metrics"

# Fields carried straight through from NormalizedMetric when present (None is
# omitted rather than written as 0/empty, so a field a given schema version
# never supplied is absent from the point instead of misleadingly zero).
_FLOAT_FIELDS = (
    "mtd_budget_pct", "mtd_credits", "mtd_cost_usd",
    "today_credits", "today_cost_usd", "daily_credit_stddev",
    "forecast_low", "forecast_high",
    "total_credits", "total_tokens",
)
_INT_FIELDS = (
    "repo_count", "model_count", "budget_trend", "tz_offset_minutes",
    "total_event_count", "estimated_event_count",
)

# Map entries become individual fields ("model_credits_<key>"); keys are
# sanitised so a hostile model id can't smuggle field-name syntax. Fields
# (unlike tags) are not indexed, so per-model field names carry no
# cardinality cost.
_MAP_FIELDS = ("model_credits", "surface_credits", "language_credits", "cost_by_category")
_FIELD_KEY_RE = re.compile(r"[^A-Za-z0-9._-]+")


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
    metric: NormalizedMetric,
    source: str = "unknown",
) -> None:
    """Convert a normalized metric to an InfluxDB Point and write it (awaiting the
    async write API so the event loop is never blocked on the network).

    `connector` becomes its own tag so a single instance running multiple
    connectors (e.g. Copilot and Claude Code) can be split apart in Grafana.
    Anything the current server doesn't have a typed field for lands in
    `extra_json`, so a future server version can read it back instead of it
    having been discarded on ingest.
    """
    point = (
        Point(_MEASUREMENT)
        .tag("instance_id", metric.instance_id or "unknown")
        .tag("schema_version", str(metric.schema_version))
        .tag("source", source)
        .tag("connector", metric.connector or "unknown")
        .field("top_model", metric.top_model or "")
        .field("active_models_count", len(metric.active_models))
    )

    for name in _FLOAT_FIELDS:
        value = getattr(metric, name)
        if value is not None:
            point = point.field(name, float(value))

    for name in _INT_FIELDS:
        value = getattr(metric, name)
        if value is not None:
            point = point.field(name, int(value))

    if metric.forecast_basis is not None:
        point = point.field("forecast_basis", metric.forecast_basis)

    # Counter maps: one field per entry so Grafana can query them directly.
    for map_name in _MAP_FIELDS:
        for key, value in getattr(metric, map_name).items():
            point = point.field(_field_key(map_name, key), float(value))

    # One comma-joined list field — the old active_model_{i} position-indexed
    # field names were unbounded and order-dependent (an InfluxDB anti-pattern).
    if metric.active_models:
        point = point.field("active_models", ",".join(metric.active_models))

    if metric.extra:
        point = point.field("extra_json", json.dumps(metric.extra, default=str))

    point = point.time(metric.ts_ms, WritePrecision.MS)

    logger.debug(
        "Writing InfluxDB point: measurement=%s instance=%s ts=%d",
        _MEASUREMENT,
        metric.instance_id,
        metric.ts_ms,
    )
    await write_api.write(bucket=bucket, org=org, record=point)


async def ping_influx(client: InfluxDBClientAsync) -> bool:
    """Return True if InfluxDB responds to a ping."""
    try:
        return await client.ping()
    except Exception as exc:
        logger.warning("InfluxDB ping failed: %s", exc)
        return False
