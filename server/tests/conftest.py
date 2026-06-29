"""pytest fixtures shared across all test modules."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

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
    "API_KEYS": "test-key-valid,second-key",
    "LOG_LEVEL": "DEBUG",
    "RATE_LIMIT": "1000/minute",  # effectively unlimited during tests
}

VALID_API_KEY = "test-key-valid"


def _patch_env_and_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Apply env vars and reset the Settings singleton."""
    for k, v in _DEFAULT_ENV.items():
        monkeypatch.setenv(k, v)

    # Reset the cached singleton so each test gets a fresh Settings instance
    import src.config as config_module

    monkeypatch.setattr(config_module, "_settings", None)


@pytest.fixture()
def mock_write_api() -> MagicMock:
    return MagicMock()


@pytest.fixture()
def mock_influx_client(mock_write_api: MagicMock) -> MagicMock:
    client = MagicMock()
    client.write_api.return_value = mock_write_api
    client.ping.return_value = True
    return client


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch, mock_influx_client: MagicMock) -> TestClient:
    """
    TestClient with mocked InfluxDB.  Import and build the app *inside* the
    fixture so the monkeypatched env is already in place when Settings() runs.
    """
    _patch_env_and_settings(monkeypatch)

    with (
        patch("src.influx.make_client", return_value=mock_influx_client),
        patch(
            "src.influx.InfluxDBClient",
            return_value=mock_influx_client,
        ),
    ):
        import importlib

        import src.main as main_module

        importlib.reload(main_module)  # pick up fresh settings
        app = main_module.create_app()

        # Manually set app.state because lifespan doesn't run in TestClient by default
        from src.config import get_settings

        app.state.settings = get_settings()
        app.state.influx_client = mock_influx_client
        app.state.write_api = mock_influx_client.write_api()

        with TestClient(app, raise_server_exceptions=False) as tc:
            yield tc


@pytest.fixture()
def valid_payload() -> dict:
    return {
        "instance_id": "abc123",
        "schema_version": 2,
        "ts": 1_700_000_000_000,
        "credits_velocity_per_hour": 1.5,
        "mtd_budget_pct": 42.0,
        "mtd_credits": 100.0,
        "mtd_cost_usd": 3.50,
        "today_credits": 10.0,
        "today_cost_usd": 0.35,
        "active_models": ["claude-sonnet-4-5", "claude-haiku-3"],
        "top_model": "claude-sonnet-4-5",
    }
