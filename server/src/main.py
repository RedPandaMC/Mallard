"""Mallard metric ingest server — FastAPI application with lifespan."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from influxdb_client.client.write_api import SYNCHRONOUS
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from .config import get_settings
from .influx import make_client
from .mqtt import run_mqtt_broker
from .routers import health as health_router
from .routers import ingest as ingest_router

logger = logging.getLogger(__name__)

_MAX_BODY_BYTES = 64 * 1024  # 64 KB


def _get_key_for_rate_limit(request: Request) -> str:
    """
    Use the raw X-API-Key header value as the rate-limit key so limits are
    per-key, not per-IP.  Falls back to client IP when the header is absent
    (unauthenticated requests will be rejected by auth before actually being
    rate-limited, but we still need a key function).
    """
    return request.headers.get("X-API-Key") or request.client.host  # type: ignore[union-attr]


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Create shared resources on startup; close them on shutdown."""
    settings = get_settings()

    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )

    logger.info("Starting Mallard ingest server (InfluxDB: %s)", settings.influx_url)

    influx_client = make_client(settings)
    write_api = influx_client.write_api(write_options=SYNCHRONOUS)

    # Stash on app.state so routers can access them via request.app.state
    app.state.settings = settings
    app.state.influx_client = influx_client
    app.state.write_api = write_api

    if settings.mqtt_enabled:
        import asyncio
        mqtt_task = asyncio.create_task(run_mqtt_broker(settings, write_api))
        app.state.mqtt_task = mqtt_task
        logger.info("MQTT broker started on port %d", settings.mqtt_port)

    yield

    logger.info("Shutting down — closing InfluxDB client")
    if settings.mqtt_enabled and hasattr(app.state, "mqtt_task"):
        app.state.mqtt_task.cancel()
    write_api.close()
    influx_client.close()


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
        "src.main:app",
        host=s.server_host,
        port=s.server_port,
        log_level=s.log_level.lower(),
    )
