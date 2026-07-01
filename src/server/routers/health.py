"""GET /health — liveness probe for Kubernetes."""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..normalize import KNOWN_SCHEMA_VERSIONS

router = APIRouter()


@router.get("/health", tags=["ops"])
async def health(request: Request) -> dict:
    """
    Returns {"status": "ok", "influx": "pong"} when InfluxDB is reachable,
    or {"status": "degraded", "influx": "error"} otherwise.
    Always returns HTTP 200 so Kubernetes does not restart the pod on InfluxDB blips.

    `min_known_schema_version`/`max_known_schema_version` report the ingest
    payload versions this server understands, so operators can spot version
    skew across a fleet of extension installs at a glance.
    """
    from ..influx import ping_influx  # local import to avoid circular deps at module load

    influx_client = request.app.state.influx_client
    influx_status = "pong" if await ping_influx(influx_client) else "error"

    return {
        "status": "ok" if influx_status == "pong" else "degraded",
        "influx": influx_status,
        "min_known_schema_version": KNOWN_SCHEMA_VERSIONS[0],
        "max_known_schema_version": KNOWN_SCHEMA_VERSIONS[-1],
    }
