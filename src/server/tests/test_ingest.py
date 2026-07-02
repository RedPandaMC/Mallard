"""Tests for POST /api/v1/ingest."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


class TestIngestHappyPath:
    def test_valid_payload_returns_202(self, client: TestClient, valid_payload: dict) -> None:
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202
        assert response.json() == {"status": "accepted"}

    def test_null_top_model_accepted(self, client: TestClient, valid_payload: dict) -> None:
        valid_payload["top_model"] = None
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202

    def test_empty_active_models_accepted(self, client: TestClient, valid_payload: dict) -> None:
        valid_payload["active_models"] = []
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202


class TestIngestAuthentication:
    def test_missing_api_key_returns_401(self, client: TestClient, valid_payload: dict) -> None:
        response = client.post("/api/v1/ingest", json=valid_payload)
        assert response.status_code == 401

    def test_wrong_api_key_returns_401(self, client: TestClient, valid_payload: dict) -> None:
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "totally-wrong-key"},
        )
        assert response.status_code == 401

    def test_second_valid_key_accepted(self, client: TestClient, valid_payload: dict) -> None:
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "second-key"},
        )
        assert response.status_code == 202

    def test_bearer_token_accepted(self, client: TestClient, valid_payload: dict) -> None:
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"Authorization": "Bearer test-key-valid"},
        )
        assert response.status_code == 202

    def test_bearer_token_wrong_returns_401(self, client: TestClient, valid_payload: dict) -> None:
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"Authorization": "Bearer totally-wrong-key"},
        )
        assert response.status_code == 401

    def test_bearer_token_empty_returns_401(self, client: TestClient, valid_payload: dict) -> None:
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"Authorization": "Bearer "},
        )
        assert response.status_code == 401

    def test_cert_cn_header_bypasses_api_key(self, client: TestClient, valid_payload: dict) -> None:
        """mTLS: ingress forwards SSL_CLIENT_S_DN_CN — no API key needed."""
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"SSL_CLIENT_S_DN_CN": "team-alpha"},
        )
        assert response.status_code == 202

    def test_cert_cn_header_wrong_api_key_still_accepted(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        """cert CN takes precedence over (even invalid) API key."""
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"SSL_CLIENT_S_DN_CN": "team-alpha", "X-API-Key": "wrong-key"},
        )
        assert response.status_code == 202

    def test_empty_cert_cn_falls_back_to_api_key(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"SSL_CLIENT_S_DN_CN": "  ", "X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202

    def test_empty_cert_cn_without_api_key_returns_401(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"SSL_CLIENT_S_DN_CN": ""},
        )
        assert response.status_code == 401

    def test_invalid_cert_cn_format_falls_back_to_api_key(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        """CN with invalid characters is rejected; valid API key still grants access."""
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={
                "SSL_CLIENT_S_DN_CN": "bad cn with spaces!",
                "X-API-Key": "test-key-valid",
            },
        )
        assert response.status_code == 202

    def test_invalid_cert_cn_without_api_key_returns_401(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        """CN with invalid characters + no API key → rejected."""
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"SSL_CLIENT_S_DN_CN": "bad cn with spaces!"},
        )
        assert response.status_code == 401

    def test_cert_cn_too_long_falls_back_to_api_key(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        """CN exceeding 64 characters is treated as invalid."""
        long_cn = "a" * 65
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"SSL_CLIENT_S_DN_CN": long_cn, "X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202


class TestIngestValidation:
    """The ingest endpoint is a tolerant reader: a well-formed payload that
    names a schema_version is accepted even with fields missing, wrongly
    typed, or unrecognized — see normalize.py. Only a body that isn't valid
    JSON, or has no schema_version at all, is rejected outright."""

    def test_malformed_json_returns_400(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/ingest",
            content=b"not valid json {{{",
            headers={"X-API-Key": "test-key-valid", "Content-Type": "application/json"},
        )
        assert response.status_code == 400

    def test_missing_schema_version_returns_400(self, client: TestClient, valid_payload: dict) -> None:
        del valid_payload["schema_version"]
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 400

    def test_json_array_body_returns_400(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/ingest",
            json=[1, 2, 3],
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 400

    def test_missing_instance_id_still_accepted_in_degraded_mode(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        del valid_payload["instance_id"]
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202

    def test_missing_ts_field_still_accepted_in_degraded_mode(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        del valid_payload["ts"]
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202

    def test_wrong_type_for_numeric_field_still_accepted_in_degraded_mode(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        valid_payload["mtd_cost_usd"] = "not-a-number"
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202

    def test_active_models_wrong_type_still_accepted_in_degraded_mode(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        valid_payload["active_models"] = "claude-sonnet"
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202

    def test_unknown_schema_version_accepted_in_degraded_mode(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        """A client newer than this server (schema_version the server has
        never seen) must not fail — it's ingested best-effort instead."""
        valid_payload["schema_version"] = 99
        valid_payload["a_field_this_server_has_never_heard_of"] = "future data"
        response = client.post(
            "/api/v1/ingest",
            json=valid_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202

    def test_v1_shaped_payload_from_an_unupgraded_extension_is_accepted(
        self, client: TestClient
    ) -> None:
        """A server upgraded ahead of the extension must still accept the
        older extension's real v1 payload shape (issue #27)."""
        v1_payload = {
            "schema_version": 1,
            "ts": "2026-01-01T00:00:00.000Z",
            "model_dist": {"gpt-4o": 1.0},
            "surface_dist": {"chat": 1.0},
            "cost_dist": {"input": 0.6, "output": 0.4},
            "input_cost_ratio": 0.6,
            "credits_velocity_per_hour": 1.5,
            "mtd_budget_pct": 42.0,
            "repo_count": 2,
            "peak_usage_hour": 14,
            "daily_credit_variance": 3.2,
            "model_count": 1,
            "surface_concentration": 0.0,
            "estimated_event_ratio": 1.0,
            "forecast_basis": "linear",
            "budget_trend": 0,
            "token_per_credit": 120.0,
            "forecast_low": 100.0,
            "forecast_high": 200.0,
            "source_connector": "local",
        }
        response = client.post(
            "/api/v1/ingest",
            json=v1_payload,
            headers={"X-API-Key": "test-key-valid"},
        )
        assert response.status_code == 202

    def test_oversized_body_returns_413(self, client: TestClient) -> None:
        # Build a payload larger than 64 KB
        oversized = "x" * (64 * 1024 + 1)
        response = client.post(
            "/api/v1/ingest",
            content=oversized.encode(),
            headers={
                "X-API-Key": "test-key-valid",
                "Content-Type": "application/json",
                "Content-Length": str(len(oversized)),
            },
        )
        assert response.status_code == 413

    def test_empty_body_returns_400(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/ingest",
            content=b"",
            headers={"X-API-Key": "test-key-valid", "Content-Type": "application/json"},
        )
        assert response.status_code == 400


class TestIngestRouteDirectly:
    """Call the route handler directly to cover the belt-and-suspenders 413 path.

    The middleware in main.py intercepts oversized requests before they reach the
    handler, so TestClient can never trigger line 35. Calling the coroutine directly
    with a mock request bypasses the middleware and exercises the fallback check.
    """

    async def test_belt_and_suspenders_413(self) -> None:
        from server.credential_verifier import StaticCredentialVerifier
        from server.routers.ingest import ingest

        mock_request = MagicMock()
        mock_request.headers.get = MagicMock(return_value=str(64 * 1024 + 1))

        mock_settings = MagicMock()
        mock_settings.hashed_api_keys = {}
        mock_settings.mqtt_password = ""
        mock_settings.parsed_cert_labels = {}
        verifier = StaticCredentialVerifier(mock_settings)

        # The 413 check runs before the body is ever read, so request.body()
        # is never awaited here.
        result = await ingest(
            request=mock_request,
            verifier=verifier,
        )
        assert result.status_code == 413


class TestIngestInfluxFailure:
    def test_influx_write_failure_returns_503(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        with patch("server.routers.ingest.write_payload", side_effect=RuntimeError("InfluxDB down")):
            response = client.post(
                "/api/v1/ingest",
                json=valid_payload,
                headers={"X-API-Key": "test-key-valid"},
            )
        assert response.status_code == 503
        body = response.json()
        assert "detail" in body


class TestCertLabelMapping:
    """mTLS CNs map through the CERT_LABELS store; unmapped CNs fall back to
    the CN itself as the source tag."""

    def test_mapped_cn_uses_label_as_source(self, client: TestClient, valid_payload: dict) -> None:
        # conftest seeds CERT_LABELS with team-cert:machine-01
        with patch("server.routers.ingest.write_payload") as write_mock:
            response = client.post(
                "/api/v1/ingest",
                json=valid_payload,
                headers={"SSL_CLIENT_S_DN_CN": "machine-01"},
            )
        assert response.status_code == 202
        assert write_mock.call_args.kwargs["source"] == "team-cert"

    def test_unmapped_cn_falls_back_to_cn(self, client: TestClient, valid_payload: dict) -> None:
        with patch("server.routers.ingest.write_payload") as write_mock:
            response = client.post(
                "/api/v1/ingest",
                json=valid_payload,
                headers={"SSL_CLIENT_S_DN_CN": "unmapped-cn"},
            )
        assert response.status_code == 202
        assert write_mock.call_args.kwargs["source"] == "unmapped-cn"


class TestVerifierOutage:
    def test_verifier_exception_returns_503_not_500(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        """Remote verifier with no warm cache re-raises when the secret manager is
        unreachable; the route must surface a deliberate 503, never a 500."""
        from unittest.mock import AsyncMock

        raising = MagicMock()
        raising.verify_api_key = AsyncMock(side_effect=RuntimeError("vault down"))
        original = client.app.state.verifier
        client.app.state.verifier = raising
        try:
            response = client.post(
                "/api/v1/ingest",
                json=valid_payload,
                headers={"X-API-Key": "test-key-valid"},
            )
        finally:
            client.app.state.verifier = original
        assert response.status_code == 503
        assert "Credential verification" in response.json()["detail"]

    def test_cert_label_lookup_exception_returns_503(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        from unittest.mock import AsyncMock

        raising = MagicMock()
        raising.lookup_cert_label = AsyncMock(side_effect=RuntimeError("vault down"))
        original = client.app.state.verifier
        client.app.state.verifier = raising
        try:
            response = client.post(
                "/api/v1/ingest",
                json=valid_payload,
                headers={"SSL_CLIENT_S_DN_CN": "machine-01"},
            )
        finally:
            client.app.state.verifier = original
        assert response.status_code == 503


class TestPerCredentialRateLimit:
    def test_label_exceeding_limit_gets_429_with_retry_after(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        from server.rate_limit import SlidingWindowLimiter

        original = client.app.state.label_limiter
        client.app.state.label_limiter = SlidingWindowLimiter(2, 60)
        try:
            for _ in range(2):
                ok = client.post(
                    "/api/v1/ingest",
                    json=valid_payload,
                    headers={"X-API-Key": "test-key-valid"},
                )
                assert ok.status_code == 202
            blocked = client.post(
                "/api/v1/ingest",
                json=valid_payload,
                headers={"X-API-Key": "test-key-valid"},
            )
        finally:
            client.app.state.label_limiter = original
        assert blocked.status_code == 429
        assert int(blocked.headers["Retry-After"]) >= 1

    def test_limit_is_per_credential_not_global(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        """Exhausting one credential's budget must not block another's."""
        from server.rate_limit import SlidingWindowLimiter

        original = client.app.state.label_limiter
        client.app.state.label_limiter = SlidingWindowLimiter(1, 60)
        try:
            first = client.post(
                "/api/v1/ingest",
                json=valid_payload,
                headers={"X-API-Key": "test-key-valid"},
            )
            blocked = client.post(
                "/api/v1/ingest",
                json=valid_payload,
                headers={"X-API-Key": "test-key-valid"},
            )
            other = client.post(
                "/api/v1/ingest",
                json=valid_payload,
                headers={"X-API-Key": "second-key"},
            )
        finally:
            client.app.state.label_limiter = original
        assert first.status_code == 202
        assert blocked.status_code == 429
        assert other.status_code == 202


class TestChunkedBodyCap:
    def test_chunked_body_over_limit_returns_413(self, client: TestClient) -> None:
        """Transfer-Encoding: chunked carries no Content-Length, bypassing the
        middleware fast path — the streamed read must still enforce the cap."""

        def gen():
            for _ in range(70):
                yield b"x" * 1024

        response = client.post(
            "/api/v1/ingest",
            content=gen(),
            headers={"X-API-Key": "test-key-valid", "Content-Type": "application/json"},
        )
        assert response.status_code == 413

    def test_chunked_body_under_limit_processed(
        self, client: TestClient, valid_payload: dict
    ) -> None:
        import json as json_module

        raw = json_module.dumps(valid_payload).encode()

        def gen():
            yield raw

        response = client.post(
            "/api/v1/ingest",
            content=gen(),
            headers={"X-API-Key": "test-key-valid", "Content-Type": "application/json"},
        )
        assert response.status_code == 202


class TestExtractCertCn:
    """Proxies differ in what they forward: a bare CN, or the full subject DN
    (nginx $ssl_client_s_dn, Caddy {tls_client_subject})."""

    def test_bare_cn_passes_through(self) -> None:
        from server.routers.ingest import _extract_cert_cn

        assert _extract_cert_cn("machine-01") == "machine-01"

    def test_comma_dn_extracts_cn(self) -> None:
        from server.routers.ingest import _extract_cert_cn

        assert _extract_cert_cn("CN=machine-01,O=team,C=NL") == "machine-01"

    def test_slash_dn_extracts_cn(self) -> None:
        from server.routers.ingest import _extract_cert_cn

        assert _extract_cert_cn("/C=NL/O=team/CN=machine-01") == "machine-01"

    def test_lowercase_cn_attribute(self) -> None:
        from server.routers.ingest import _extract_cert_cn

        assert _extract_cert_cn("cn=machine-01,o=team") == "machine-01"

    def test_empty_returns_empty(self) -> None:
        from server.routers.ingest import _extract_cert_cn

        assert _extract_cert_cn("") == ""
        assert _extract_cert_cn("   ") == ""

    def test_dn_without_cn_rejected(self) -> None:
        from server.routers.ingest import _extract_cert_cn

        assert _extract_cert_cn("O=team,C=NL") == ""

    def test_cn_with_unsafe_chars_rejected(self) -> None:
        from server.routers.ingest import _extract_cert_cn

        assert _extract_cert_cn("CN=bad cn with spaces,O=x") == ""

    def test_full_dn_via_route_maps_to_label(self, client: TestClient, valid_payload: dict) -> None:
        with patch("server.routers.ingest.write_payload") as write_mock:
            response = client.post(
                "/api/v1/ingest",
                json=valid_payload,
                headers={"SSL_CLIENT_S_DN_CN": "CN=machine-01,O=acme"},
            )
        assert response.status_code == 202
        assert write_mock.call_args.kwargs["source"] == "team-cert"


class TestExtractBearer:
    def test_valid_bearer_header(self) -> None:
        from server.routers.ingest import _extract_bearer

        assert _extract_bearer("Bearer my-token") == "my-token"

    def test_empty_bearer_header(self) -> None:
        from server.routers.ingest import _extract_bearer

        assert _extract_bearer("Bearer ") == ""

    def test_non_bearer_header(self) -> None:
        from server.routers.ingest import _extract_bearer

        assert _extract_bearer("Basic dXNlcjpwYXNz") == ""

    def test_empty_string(self) -> None:
        from server.routers.ingest import _extract_bearer

        assert _extract_bearer("") == ""
