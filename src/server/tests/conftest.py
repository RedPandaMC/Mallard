"""pytest fixtures shared across all test modules."""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Default env vars so Settings() can be constructed without a real .env file
# ---------------------------------------------------------------------------
_DEFAULT_ENV = {
    "INFLUX_URL": "http://influxdb-test:8086",
    "INFLUX_TOKEN": "testtoken",
    "INFLUX_ORG": "mallard",
    "INFLUX_BUCKET": "metrics",
    # Bare keys (no label) — label will be "unknown"; labeled keys also supported.
    # Only used to build a StaticCredentialVerifier directly in the `client` fixture
    # below; production Settings can no longer select the static backend at all.
    # First key bare (label "unknown"); second labeled so per-credential tests
    # can distinguish the two buckets.
    "API_KEYS": "test-key-valid,team-b:second-key",
    # mTLS CN → label mapping exercised by TestCertLabelMapping
    "CERT_LABELS": "team-cert:machine-01",
    "LOG_LEVEL": "DEBUG",
    "RATE_LIMIT": "1000/minute",  # effectively unlimited during tests
    # A secret manager is mandatory to construct Settings at all now, even though
    # these tests bypass it by constructing StaticCredentialVerifier directly.
    "SECRET_MANAGER_TYPE": "openbao",
    "SECRET_MANAGER_URL": "http://secret-manager-test:8200",
    "SECRET_MANAGER_TOKEN": "test-sm-token",
}

VALID_API_KEY = "test-key-valid"


def _patch_env_and_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Apply env vars and reset the Settings singleton."""
    for k, v in _DEFAULT_ENV.items():
        monkeypatch.setenv(k, v)

    # Reset the cached singleton so each test gets a fresh Settings instance
    import server.config as config_module

    monkeypatch.setattr(config_module, "_settings", None)


@pytest.fixture()
def mock_write_api() -> MagicMock:
    # The async write API: write() is awaited by write_payload().
    api = MagicMock()
    api.write = AsyncMock(return_value=True)
    return api


@pytest.fixture()
def mock_influx_client(mock_write_api: MagicMock) -> MagicMock:
    # InfluxDBClientAsync: write_api() is sync and returns the async write API;
    # ping()/close() are awaited.
    client = MagicMock()
    client.write_api.return_value = mock_write_api
    client.ping = AsyncMock(return_value=True)
    client.close = AsyncMock()
    return client


def _build_client(
    monkeypatch: pytest.MonkeyPatch,
    mock_influx_client: MagicMock,
    extra_env: dict[str, str] | None = None,
):
    """
    TestClient with mocked InfluxDB.  Import and build the app *inside* the
    fixture so the monkeypatched env is already in place when Settings() runs.
    """
    _patch_env_and_settings(monkeypatch)
    for k, v in (extra_env or {}).items():
        monkeypatch.setenv(k, v)

    from server.credential_verifier import StaticCredentialVerifier

    with (
        patch("server.influx.make_client", return_value=mock_influx_client),
        patch(
            "server.influx.InfluxDBClientAsync",
            return_value=mock_influx_client,
        ),
    ):
        import importlib

        import server.main as main_module

        importlib.reload(main_module)  # pick up fresh settings; also rebinds create_verifier
        app = main_module.create_app()

        # `with TestClient(...) as tc` runs the real lifespan, which calls the real
        # create_verifier(settings). Settings.secret_manager_type is now always a
        # live backend (openbao/infisical), so without this patch lifespan would
        # build a real remote verifier that makes actual network calls to the fake
        # SECRET_MANAGER_URL above. Patched after the reload so it isn't rebound
        # back to the real function by the `from .credential_verifier import
        # create_verifier` line executing again. Tests want the fast, no-network
        # static verifier instead, keyed off the same API_KEYS/MQTT_PASSWORD env vars.
        with (
            patch.object(
                main_module,
                "create_verifier",
                side_effect=lambda settings: StaticCredentialVerifier(settings),
            ),
            TestClient(app, raise_server_exceptions=False) as tc,
        ):
            yield tc


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch, mock_influx_client: MagicMock) -> TestClient:
    yield from _build_client(monkeypatch, mock_influx_client)


# Two secrets configured — the second is "current", the first simulates the
# old secret still being accepted during a rotation window.
HMAC_SECRETS = ["old-signing-secret", "test-signing-secret"]


@pytest.fixture()
def hmac_client(monkeypatch: pytest.MonkeyPatch, mock_influx_client: MagicMock) -> TestClient:
    """Client with X-Mallard-Signature-256 verification enabled."""
    yield from _build_client(
        monkeypatch,
        mock_influx_client,
        {"WEBHOOK_HMAC_SECRETS": ",".join(HMAC_SECRETS)},
    )


JWT_HMAC_SECRET = "jwt-signing-secret-for-tests"


@pytest.fixture()
def jwt_client(monkeypatch: pytest.MonkeyPatch, mock_influx_client: MagicMock) -> TestClient:
    """Client with HS256 JWT bearer auth enabled; 'ci-bot' claim maps to label 'ci'."""
    yield from _build_client(
        monkeypatch,
        mock_influx_client,
        {
            "JWT_HMAC_SECRET": JWT_HMAC_SECRET,
            "JWT_ALGORITHMS": "HS256",
            "JWT_LABELS": "ci:ci-bot",
        },
    )


@pytest.fixture()
def valid_payload() -> dict:
    return {
        "instance_id": "abc123",
        "schema_version": 3,
        "ts": 1_700_000_000_000,
        "tz_offset_minutes": 120,
        "mtd_budget_pct": 42.0,
        "mtd_credits": 100.0,
        "mtd_cost_usd": 3.50,
        "today_credits": 10.0,
        "today_cost_usd": 0.35,
        "total_credits": 110.0,
        "total_event_count": 12,
        "estimated_event_count": 9,
        "model_credits": {"claude-sonnet-4-5": 80.0, "claude-haiku-3": 30.0},
        "surface_credits": {"agent": 110.0},
        "cost_by_category": {"input": 1.5, "output": 2.0},
        "active_models": ["claude-sonnet-4-5", "claude-haiku-3"],
        "top_model": "claude-sonnet-4-5",
    }
