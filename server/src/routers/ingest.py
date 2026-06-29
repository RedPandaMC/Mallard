"""POST /api/v1/ingest — accepts metric payloads from Mallard instances."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse

from ..auth import require_api_key
from ..influx import write_payload
from ..schemas import IngestPayload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["ingest"])

# 64 KB body size limit (enforced by middleware in main.py, validated here as a safety belt)
_MAX_BODY_BYTES = 64 * 1024


@router.post("/ingest", status_code=status.HTTP_202_ACCEPTED)
async def ingest(
    payload: IngestPayload,
    request: Request,
    key_hash: str = Depends(require_api_key),
) -> JSONResponse:
    """
    Accepts a Mallard metric payload, validates it, and writes one InfluxDB point.
    Rate-limited to RATE_LIMIT per unique API key (enforced via slowapi middleware).
    """
    # Belt-and-suspenders body size check (middleware does the primary enforcement)
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > _MAX_BODY_BYTES:
        return JSONResponse(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            content={"detail": "Request body exceeds 64 KB limit"},
        )

    write_api = request.app.state.write_api
    settings = request.app.state.settings

    write_payload(
        write_api=write_api,
        bucket=settings.influx_bucket,
        org=settings.influx_org,
        payload=payload,
    )

    logger.info(
        "Ingested payload: instance=%s schema_v=%d key_hash_prefix=%s…",
        payload.instance_id,
        payload.schema_version,
        key_hash[:8],
    )

    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={"status": "accepted"},
    )
