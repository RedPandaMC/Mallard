"""InfluxDB v2 client factory and write helper."""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS

from .config import Settings
from .normalize import NormalizedMetric

if TYPE_CHECKING:
    from influxdb_client.client.write_api import WriteApi

logger = logging.getLogger(__name__)

_MEASUREMENT = "mallard_metrics"

# Fields carried straight through from NormalizedMetric when present (None is
# omitted rather than written as 0/empty, so a field a given schema version
# never supplied is absent from the point instead of misleadingly zero).
_FLOAT_FIELDS = (
    "credits_velocity_per_hour", "mtd_budget_pct", "mtd_credits", "mtd_cost_usd",
    "today_credits", "today_cost_usd", "daily_credit_variance",
    "surface_concentration", "estimated_event_ratio", "token_per_credit",
    "forecast_low", "forecast_high",
)
_INT_FIELDS = ("repo_count", "peak_usage_hour", "model_count", "budget_trend")


def make_client(settings: Settings) -> InfluxDBClient:
    """Create and return an InfluxDB v2 client configured from *settings*."""
    return InfluxDBClient(
        url=settings.influx_url,
        token=settings.influx_token,
        org=settings.influx_org,
    )


def write_payload(
    write_api: "WriteApi",
    bucket: str,
    org: str,
    metric: NormalizedMetric,
    source: str = "unknown",
) -> None:
    """Convert a normalized metric to an InfluxDB Point and write it synchronously.

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

    # Store individual active models as separate fields for querying
    for i, model in enumerate(metric.active_models):
        point = point.field(f"active_model_{i}", model)

    if metric.extra:
        point = point.field("extra_json", json.dumps(metric.extra, default=str))

    point = point.time(metric.ts_ms, WritePrecision.MS)

    logger.debug(
        "Writing InfluxDB point: measurement=%s instance=%s ts=%d",
        _MEASUREMENT,
        metric.instance_id,
        metric.ts_ms,
    )
    write_api.write(bucket=bucket, org=org, record=point)


async def ping_influx(client: InfluxDBClient) -> bool:
    """Return True if InfluxDB responds to a ping."""
    try:
        return client.ping()
    except Exception as exc:
        logger.warning("InfluxDB ping failed: %s", exc)
        return False
