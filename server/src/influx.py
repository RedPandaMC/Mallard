"""InfluxDB v2 client factory and write helper."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS

from .config import Settings
from .schemas import IngestPayload

if TYPE_CHECKING:
    from influxdb_client.client.write_api import WriteApi

logger = logging.getLogger(__name__)

_MEASUREMENT = "mallard_metrics"


def make_client(settings: Settings) -> InfluxDBClient:
    """Create and return an InfluxDB v2 client configured from *settings*."""
    return InfluxDBClient(
        url=settings.influx_url,
        token=settings.influx_token,
        org=settings.influx_org,
    )


def write_payload(write_api: "WriteApi", bucket: str, org: str, payload: IngestPayload) -> None:
    """Convert *payload* to an InfluxDB Point and write it synchronously."""
    point = (
        Point(_MEASUREMENT)
        .tag("instance_id", payload.instance_id)
        .tag("schema_version", str(payload.schema_version))
        .field("credits_velocity_per_hour", payload.credits_velocity_per_hour)
        .field("mtd_budget_pct", payload.mtd_budget_pct)
        .field("mtd_credits", payload.mtd_credits)
        .field("mtd_cost_usd", payload.mtd_cost_usd)
        .field("today_credits", payload.today_credits)
        .field("today_cost_usd", payload.today_cost_usd)
        .field("top_model", payload.top_model or "")
        .field("active_models_count", len(payload.active_models))
        .time(payload.ts, WritePrecision.MS)
    )

    # Store individual active models as separate fields for querying
    for i, model in enumerate(payload.active_models):
        point = point.field(f"active_model_{i}", model)

    logger.debug(
        "Writing InfluxDB point: measurement=%s instance=%s ts=%d",
        _MEASUREMENT,
        payload.instance_id,
        payload.ts,
    )
    write_api.write(bucket=bucket, org=org, record=point)


async def ping_influx(client: InfluxDBClient) -> bool:
    """Return True if InfluxDB responds to a ping."""
    try:
        return client.ping()
    except Exception as exc:
        logger.warning("InfluxDB ping failed: %s", exc)
        return False
