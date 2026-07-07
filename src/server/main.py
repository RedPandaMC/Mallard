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


def _get_key_for_rate_limit(request: Request) -> str:
    """
    Pre-auth limiter key: client IP only. Keying on a client-supplied header
    (the previous X-API-Key scheme) let an attacker mint a fresh bucket per
    request with junk values, defeating the limit entirely — and stored raw
    secrets as limiter keys. Per-credential limiting happens after auth in the
    ingest route, keyed on the verified label (see rate_limit.py).
    """
    return request.client.host if request.client else "unknown"


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
        # Disable automatic /docs and /redoc in production if desired:
        # docs_url=None, redoc_url=None,
    )

    # ── Middleware ────────────────────────────────────────────────────────────
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)

    # ── Body size limit middleware ────────────────────────────────────────────
    @app.middleware("http")
    async def limit_body_size(request: Request, call_next):  # type: ignore[no-untyped-def]
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > _MAX_BODY_BYTES:
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
