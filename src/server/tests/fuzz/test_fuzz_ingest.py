"""
Hypothesis property-based fuzz tests for POST /api/v1/ingest.

Invariant: the server MUST NEVER return a 5xx response on arbitrary input.
All server-side errors should be client errors (4xx).
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings, strategies as st


def _make_test_client() -> TestClient:
    """Build a fresh TestClient with mocked InfluxDB."""
    import importlib
    import os

    # Ensure env vars are set
    os.environ.setdefault("INFLUX_URL", "http://influxdb-test:8086")
    os.environ.setdefault("INFLUX_TOKEN", "testtoken")
    os.environ.setdefault("INFLUX_ORG", "mallard")
    os.environ.setdefault("INFLUX_BUCKET", "metrics")
    os.environ.setdefault("API_KEYS", "test-key-valid")
    os.environ.setdefault("RATE_LIMIT", "100000/minute")
    os.environ.setdefault("SECRET_MANAGER_TYPE", "openbao")
    os.environ.setdefault("SECRET_MANAGER_URL", "http://secret-manager-test:8200")
    os.environ.setdefault("SECRET_MANAGER_TOKEN", "test-sm-token")

    import server.config as config_module

    config_module._settings = None

    mock_client = MagicMock()
    mock_client.ping.return_value = True
    mock_write_api = MagicMock()
    mock_client.write_api.return_value = mock_write_api

    with patch("server.influx.make_client", return_value=mock_client):
        import server.main as main_module

        importlib.reload(main_module)
        app = main_module.create_app()
        from server.config import get_settings

        from server.credential_verifier import StaticCredentialVerifier

        settings = get_settings()
        app.state.settings = settings
        app.state.influx_client = mock_client
        app.state.write_api = mock_write_api
        app.state.verifier = StaticCredentialVerifier(settings)
        return TestClient(app, raise_server_exceptions=False)


# Build the client once at module level to avoid rebuilding for every hypothesis example
_fuzz_client = _make_test_client()


@given(body=st.binary(max_size=65536))
@settings(
    max_examples=200,
    suppress_health_check=[HealthCheck.too_slow],
    deadline=None,
)
def test_arbitrary_binary_body_never_causes_5xx(body: bytes) -> None:
    """POST arbitrary bytes — server must return 4xx, never 5xx."""
    response = _fuzz_client.post(
        "/api/v1/ingest",
        content=body,
        headers={"X-API-Key": "test-key-valid", "Content-Type": "application/json"},
    )
    assert response.status_code < 500, (
        f"Server returned {response.status_code} for body={body[:50]!r}…\n"
        f"Response: {response.text[:200]}"
    )


@given(body=st.binary(max_size=65536))
@settings(
    max_examples=100,
    suppress_health_check=[HealthCheck.too_slow],
    deadline=None,
)
def test_arbitrary_body_without_auth_returns_401_or_4xx(body: bytes) -> None:
    """Without an API key, server must return 401 (or 413 for oversized), never 5xx."""
    response = _fuzz_client.post(
        "/api/v1/ingest",
        content=body,
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code < 500, (
        f"Server returned {response.status_code} without auth\n"
        f"Response: {response.text[:200]}"
    )


@given(
    data=st.dictionaries(
        keys=st.text(max_size=50),
        values=st.one_of(
            st.none(),
            st.booleans(),
            st.integers(),
            st.floats(allow_nan=False, allow_infinity=False),
            st.text(max_size=100),
            st.lists(st.text(max_size=20), max_size=10),
        ),
        max_size=20,
    )
)
@settings(
    max_examples=200,
    suppress_health_check=[HealthCheck.too_slow],
    deadline=None,
)
def test_arbitrary_json_dict_never_causes_5xx(data: dict) -> None:
    """POST arbitrary JSON objects — validation should catch them without crashing."""
    response = _fuzz_client.post(
        "/api/v1/ingest",
        json=data,
        headers={"X-API-Key": "test-key-valid"},
    )
    assert response.status_code < 500, (
        f"Server returned {response.status_code} for data={data}\n"
        f"Response: {response.text[:200]}"
    )
