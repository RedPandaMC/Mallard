"""POST /api/v1/ingest — accepts metric payloads from Mallard instances."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import math
import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse

from ..credential_verifier import CredentialVerifier
from ..deps import get_verifier
from ..influx import write_payload
from ..normalize import InvalidIngestPayload, normalize_payload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["ingest"])

# 64 KB body size limit. The middleware in main.py rejects a declared
# Content-Length above this as a fast path; _read_body_capped() enforces it on
# the actual bytes, which also covers chunked requests that carry no
# Content-Length header at all.
_MAX_BODY_BYTES = 64 * 1024

# CN header values become InfluxDB tag values; restrict to the same safe character set as labels.
_CERT_CN_RE = re.compile(r"^[\w._@-]{1,64}$")

# CN component inside a full subject DN ("CN=machine-01,O=team" or "/O=team/CN=machine-01")
_DN_CN_RE = re.compile(r"(?:^|[,/])\s*CN=([^,/+]+)", re.IGNORECASE)


def _extract_cert_cn(header_value: str) -> str:
    """Normalise the forwarded client-cert identity header to a bare CN.

    Proxies differ: nginx's standard $ssl_client_s_dn and Caddy's
    {tls_client_subject} forward the *full* subject DN, while a bespoke
    setup may forward just the CN. Accept both; return "" when no valid
    CN can be extracted.
    """
    value = header_value.strip()
    if not value:
        return ""
    if _CERT_CN_RE.match(value):
        return value
    m = _DN_CN_RE.search(value)
    if m:
        cn = m.group(1).strip()
        if _CERT_CN_RE.match(cn):
            return cn
    logger.warning("Rejected SSL_CLIENT_S_DN_CN with no extractable CN: %r", value)
    return ""


def _extract_bearer(auth_header: str) -> str:
    """Extract token from 'Bearer <token>'; return empty string if not a Bearer header."""
    prefix = "Bearer "
    return auth_header[len(prefix):] if auth_header.startswith(prefix) else ""


async def _read_body_capped(request: Request, limit: int = _MAX_BODY_BYTES) -> bytes | None:
    """Read the request body, aborting as soon as it exceeds *limit*.

    Returns None when the limit is exceeded. Unlike checking Content-Length,
    this cannot be bypassed with Transfer-Encoding: chunked, and it stops
    buffering the moment the cap is crossed instead of reading the whole
    body into memory first.
    """
    chunks = bytearray()
    async for chunk in request.stream():
        chunks.extend(chunk)
        if len(chunks) > limit:
            return None
    return bytes(chunks)


def _verify_signature(body: bytes, header_value: str, secrets: list[str]) -> bool:
    """Verify an X-Mallard-Signature-256 header ("sha256=<hex>") against the raw
    body for *any* configured secret — accepting multiple secrets gives key
    rotation a grace window (add the new secret, roll out clients, drop the old).
    """
    prefix = "sha256="
    if not header_value.startswith(prefix):
        return False
    provided = header_value[len(prefix):].strip().lower()
    matched = False
    for secret in secrets:
        expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        # No early exit: compare against every secret to keep timing flat.
        if hmac.compare_digest(provided, expected):
            matched = True
    return matched


async def _resolve_source(request: Request, verifier: CredentialVerifier) -> str:
    """Authenticate the request and return the source label for tagging.

    Auth precedence:
      1. mTLS client cert — CN forwarded as SSL_CLIENT_S_DN_CN by the ingress,
         which has already verified the cert. The CN maps through the optional
         CERT_LABELS store; unmapped CNs use the CN itself as the source.
      2. X-API-Key header.
      3. Authorization: Bearer <token> (token treated as API key value).

    Raises 401 for missing/invalid credentials and 503 when the credential
    store is unreachable (remote secret manager down with no warm cache).
    """
    cert_cn = _extract_cert_cn(request.headers.get("SSL_CLIENT_S_DN_CN", ""))

    try:
        if cert_cn:
            label = await verifier.lookup_cert_label(cert_cn)
            return label if label is not None else cert_cn

        api_key = request.headers.get("X-API-Key") or _extract_bearer(
            request.headers.get("Authorization", "")
        )
        if not api_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing credentials",
            )
        identity = await verifier.verify_api_key(api_key)
    except HTTPException:
        raise
    except Exception as exc:
        # Remote verifier with an empty cache and an unreachable secret manager
        # re-raises; surface it as a deliberate 503 instead of an unhandled 500.
        logger.error("Credential verification unavailable: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Credential verification unavailable",
        ) from exc

    if identity is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )
    return identity.label


@router.post("/ingest", status_code=status.HTTP_202_ACCEPTED)
async def ingest(
    request: Request,
    verifier: Annotated[CredentialVerifier, Depends(get_verifier)],
) -> JSONResponse:
    """
    Accepts a Mallard metric payload and writes one InfluxDB point.

    Rate limiting is two-layer: per client IP before auth (slowapi middleware)
    and per verified credential label here (SlidingWindowLimiter), so one
    team's flood cannot exhaust another's budget and junk credentials cannot
    mint fresh buckets.

    Tolerant of schema drift: any well-formed JSON body naming a
    `schema_version` is accepted, even one this server doesn't recognize yet
    (see normalize.py) — an extension can be upgraded ahead of its server
    without every export failing. Only a body that isn't valid JSON, or
    doesn't carry a `schema_version` at all, is rejected outright.
    """
    # Fast-path 413 for requests honest enough to declare their size
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > _MAX_BODY_BYTES:
        return JSONResponse(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            content={"detail": "Request body exceeds 64 KB limit"},
        )

    # Authenticate before reading or parsing a single body byte.
    source = await _resolve_source(request, verifier)

    limiter = getattr(request.app.state, "label_limiter", None)
    if limiter is not None:
        retry_after = limiter.check(source)
        if retry_after is not None:
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={"detail": "Rate limit exceeded for this credential"},
                headers={"Retry-After": str(max(1, math.ceil(retry_after)))},
            )

    body = await _read_body_capped(request)
    if body is None:
        return JSONResponse(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            content={"detail": "Request body exceeds 64 KB limit"},
        )

    # Optional HMAC request signing: enforced only when the operator has
    # configured WEBHOOK_HMAC_SECRETS (opt-in, backward compatible). The
    # credential store is already warm here — _resolve_source above fetched it.
    try:
        hmac_secrets = await verifier.get_webhook_hmac_secrets()
    except Exception as exc:
        logger.error("Credential verification unavailable: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Credential verification unavailable",
        ) from exc
    if hmac_secrets:
        signature = request.headers.get("X-Mallard-Signature-256", "")
        if not signature:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing signature",
            )
        if not _verify_signature(body, signature, hmac_secrets):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid signature",
            )

    try:
        raw = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Body is not valid JSON",
        ) from exc
    if not isinstance(raw, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Body must be a JSON object",
        )

    try:
        metric = normalize_payload(raw)
    except InvalidIngestPayload as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    write_api = request.app.state.write_api
    settings = request.app.state.settings

    try:
        write_payload(
            write_api=write_api,
            bucket=settings.influx_bucket,
            org=settings.influx_org,
            metric=metric,
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
        metric.instance_id,
        metric.schema_version,
        source,
    )

    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={"status": "accepted"},
    )
