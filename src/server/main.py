"""Mallard metric ingest server — FastAPI application with lifespan."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from .config import get_settings
from .credential_verifier import create_verifier
from .influx import make_client
from .mqtt import run_mqtt_broker
from .rate_limit import InProcessRateLimiter, create_rate_limiter
from .routers import health as health_router
from .routers import ingest as ingest_router

logger = logging.getLogger(__name__)

_MAX_BODY_BYTES = 64 * 1024  # 64 KB


def _client_ip_from_xff(xff: str, trusted: list) -> str | None:
    """Right-most X-Forwarded-For hop that is not a trusted proxy.

    Walking from the right trusts only what our own proxies appended: the
    right-most untrusted entry is the IP the outermost trusted proxy actually
    saw connect. Anything the client prepended itself sits further left and is
    ignored, so a client can't mint limiter buckets with junk XFF values.
    Returns None (caller falls back to the peer IP) on a malformed chain.
    """
    import ipaddress

    for hop in reversed([h.strip() for h in xff.split(",") if h.strip()]):
        try:
            ip = ipaddress.ip_address(hop)
        except ValueError:
            return None
        if not any(ip in net for net in trusted):
            return str(ip)
    return None


def _get_key_for_rate_limit(request: Request) -> str:
    """
    Pre-auth limiter key: the real client IP. Keying on a client-supplied
    header (the previous X-API-Key scheme) let an attacker mint a fresh bucket
    per request with junk values, defeating the limit entirely — and stored raw
    secrets as limiter keys. Per-credential limiting happens after auth in the
    ingest route, keyed on the verified label (see rate_limit.py).

    When the connection comes from a proxy listed in TRUSTED_PROXIES, the key
    is derived from X-Forwarded-For (see _client_ip_from_xff) — otherwise every
    request behind the proxy would share the proxy's IP as one global bucket.
    """
    import ipaddress

    peer = request.client.host if request.client else "unknown"
    trusted = get_settings().parsed_trusted_proxies
    if trusted and peer != "unknown":
        try:
            peer_ip = ipaddress.ip_address(peer)
        except ValueError:  # pragma: no cover - uvicorn always hands us an IP
            return peer
        if any(peer_ip in net for net in trusted):
            xff = request.headers.get("x-forwarded-for")
            if xff:
                client = _client_ip_from_xff(xff, trusted)
                if client is not None:
                    return client
    return peer


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Create shared resources on startup; close them on shutdown."""
    settings = get_settings()

    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )

    logger.info("Starting Mallard ingest server (InfluxDB: %s)", settings.influx_url)

    import asyncio

    influx_client = make_client(settings)
    write_api = influx_client.write_api()
    verifier = create_verifier(settings)

    # Post-auth per-credential limiter (the slowapi middleware above is per-IP).
    # Redis-backed in production so the limit holds across replicas; in-process
    # fallback for single-node/dev needs periodic pruning of expired keys.
    label_limiter = await create_rate_limiter(settings)

    # Stash on app.state so routers can access them via request.app.state
    app.state.settings = settings
    app.state.influx_client = influx_client
    app.state.write_api = write_api
    app.state.verifier = verifier
    app.state.label_limiter = label_limiter

    cleanup_task: asyncio.Task | None = None
    if isinstance(label_limiter, InProcessRateLimiter):
        cleanup_task = asyncio.create_task(_prune_limiter(label_limiter, settings))

    if settings.mqtt_enabled:
        mqtt_task = asyncio.create_task(run_mqtt_broker(settings, write_api, verifier))
        app.state.mqtt_task = mqtt_task
        logger.info("MQTT broker started on port %d", settings.mqtt_port)

    yield

    logger.info("Shutting down — closing InfluxDB client")
    if settings.mqtt_enabled and hasattr(app.state, "mqtt_task"):
        app.state.mqtt_task.cancel()
    if cleanup_task is not None:
        cleanup_task.cancel()
    await label_limiter.aclose()
    await influx_client.close()


async def _prune_limiter(limiter: InProcessRateLimiter, settings) -> None:
    """Periodically evict expired keys from the in-process limiter so its map
    doesn't grow unbounded. (The Redis backend uses per-key TTLs instead.)"""
    import asyncio

    interval = 300.0
    try:
        while True:
            await asyncio.sleep(interval)
            limiter.cleanup()
    except asyncio.CancelledError:  # pragma: no cover - shutdown path
        pass


def create_app() -> FastAPI:
    settings = get_settings()

    limiter = Limiter(key_func=_get_key_for_rate_limit, default_limits=[settings.rate_limit])

    app = FastAPI(
        title="Mallard Ingest Server",
        description="Accepts metric payloads from Mallard VS Code extension instances.",
        version="1.0.0",
        lifespan=lifespan,
        # Interactive docs are recon surface on a machine-to-machine API — only
        # serve them when explicitly enabled (ENABLE_DOCS=true).
        docs_url="/docs" if settings.enable_docs else None,
        redoc_url="/redoc" if settings.enable_docs else None,
        openapi_url="/openapi.json" if settings.enable_docs else None,
    )

    # ── Middleware ────────────────────────────────────────────────────────────
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)

    # ── Body size limit middleware ────────────────────────────────────────────
    @app.middleware("http")
    async def limit_body_size(request: Request, call_next):  # type: ignore[no-untyped-def]
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                declared = int(content_length)
            except ValueError:
                # uvicorn/h11 normally reject malformed Content-Length before
                # the app sees it; belt-and-braces so it can never become a 500.
                return JSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={"detail": "Invalid Content-Length header"},
                )
            if declared > _MAX_BODY_BYTES:
                return JSONResponse(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    content={"detail": "Request body exceeds 64 KB limit"},
                )
        return await call_next(request)

    # ── Routers ───────────────────────────────────────────────────────────────
    app.include_router(health_router.router)
    app.include_router(ingest_router.router)

    return app


app = create_app()


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    s = get_settings()
    uvicorn.run(
        "server.main:app",
        host=s.server_host,
        port=s.server_port,
        log_level=s.log_level.lower(),
    )
