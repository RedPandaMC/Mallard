"""POST /api/v1/ingest — accepts metric payloads from Mallard instances."""

from __future__ import annotations

import logging
import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse

from ..credential_verifier import CredentialVerifier
from ..deps import get_verifier
from ..influx import write_payload
from ..schemas import IngestPayload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["ingest"])

# 64 KB body size limit (enforced by middleware in main.py, validated here as a safety belt)
_MAX_BODY_BYTES = 64 * 1024

# CN header values become InfluxDB tag values; restrict to the same safe character set as labels.
_CERT_CN_RE = re.compile(r"^[\w._@-]{1,64}$")


def _extract_bearer(auth_header: str) -> str:
    """Extract token from 'Bearer <token>'; return empty string if not a Bearer header."""
    prefix = "Bearer "
    return auth_header[len(prefix):] if auth_header.startswith(prefix) else ""


@router.post("/ingest", status_code=status.HTTP_202_ACCEPTED)
async def ingest(
    payload: IngestPayload,
    request: Request,
    verifier: Annotated[CredentialVerifier, Depends(get_verifier)],
) -> JSONResponse:
    """
    Accepts a Mallard metric payload, validates it, and writes one InfluxDB point.
    Rate-limited to RATE_LIMIT per unique API key (enforced via slowapi middleware).

    Auth precedence:
      1. mTLS client cert — CN forwarded as SSL_CLIENT_S_DN_CN by nginx ingress.
      2. X-API-Key header.
      3. Authorization: Bearer <token> (token treated as API key value).
    """
    # Belt-and-suspenders body size check (middleware does the primary enforcement)
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > _MAX_BODY_BYTES:
        return JSONResponse(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            content={"detail": "Request body exceeds 64 KB limit"},
        )

    # mTLS: cert CN forwarded by nginx ingress; ingress has already verified the cert
    cert_cn = request.headers.get("SSL_CLIENT_S_DN_CN", "").strip()
    if cert_cn and not _CERT_CN_RE.match(cert_cn):
        logger.warning("Rejected SSL_CLIENT_S_DN_CN with invalid format: %r", cert_cn)
        cert_cn = ""

    if cert_cn:
        source = cert_cn
    else:
        # Extract API key from X-API-Key header or Bearer token
        api_key = request.headers.get("X-API-Key") or _extract_bearer(
            request.headers.get("Authorization", "")
        )
        if not api_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing credentials",
            )
        identity = await verifier.verify_api_key(api_key)
        if identity is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials",
            )
        source = identity.label

    write_api = request.app.state.write_api
    settings = request.app.state.settings

    try:
        write_payload(
            write_api=write_api,
            bucket=settings.influx_bucket,
            org=settings.influx_org,
            payload=payload,
            source=source,
        )
    except Exception as exc:
        logger.error("InfluxDB write failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Metric storage unavailable",
        ) from exc

    logger.info(
        "Ingested payload: instance=%s schema_v=%d source=%s",
        payload.instance_id,
        payload.schema_version,
        source,
    )

    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={"status": "accepted"},
    )
