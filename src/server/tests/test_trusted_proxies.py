"""Tests for X-Forwarded-For handling in the pre-auth rate-limit key.

Behind a reverse proxy every connection carries the proxy's IP; without XFF
handling the per-IP limiter collapses into one shared bucket. The key function
must only trust XFF presented by peers on TRUSTED_PROXIES, and must resolve to
the right-most untrusted hop so clients can't mint buckets with junk values.
"""

from __future__ import annotations

import ipaddress
import os
from types import SimpleNamespace

import pytest

# server.main builds the FastAPI app at import time, which constructs Settings —
# provide the required env before the import (same pattern as tests/fuzz).
os.environ.setdefault("INFLUX_URL", "http://influxdb-test:8086")
os.environ.setdefault("INFLUX_TOKEN", "testtoken")

from server.main import _client_ip_from_xff, _get_key_for_rate_limit  # noqa: E402


def _nets(*cidrs: str) -> list:
    return [ipaddress.ip_network(c) for c in cidrs]


class TestClientIpFromXff:
    def test_rightmost_untrusted_hop_wins(self) -> None:
        trusted = _nets("10.0.0.0/8")
        assert _client_ip_from_xff("1.2.3.4, 10.0.0.7", trusted) == "1.2.3.4"

    def test_client_prepended_junk_ip_is_ignored(self) -> None:
        # The client sent "9.9.9.9" itself; the proxy appended the real peer.
        trusted = _nets("10.0.0.0/8")
        assert _client_ip_from_xff("9.9.9.9, 1.2.3.4, 10.0.0.7", trusted) == "1.2.3.4"

    def test_all_hops_trusted_returns_none(self) -> None:
        trusted = _nets("10.0.0.0/8")
        assert _client_ip_from_xff("10.1.1.1, 10.0.0.7", trusted) is None

    def test_malformed_hop_returns_none(self) -> None:
        trusted = _nets("10.0.0.0/8")
        assert _client_ip_from_xff("not-an-ip, 10.0.0.7", trusted) is None
        assert _client_ip_from_xff("1.2.3.4, garbage", trusted) is None

    def test_empty_header_returns_none(self) -> None:
        assert _client_ip_from_xff("", _nets("10.0.0.0/8")) is None
        assert _client_ip_from_xff(" , ,", _nets("10.0.0.0/8")) is None

    def test_ipv6_hops(self) -> None:
        trusted = _nets("fd00::/8")
        assert _client_ip_from_xff("2001:db8::1, fd00::7", trusted) == "2001:db8::1"


def _request(peer: str | None, headers: dict[str, str] | None = None):
    return SimpleNamespace(
        client=SimpleNamespace(host=peer) if peer else None,
        headers=headers or {},
    )


@pytest.fixture()
def trusted_proxy_settings(monkeypatch: pytest.MonkeyPatch):
    from .conftest import _patch_env_and_settings

    _patch_env_and_settings(monkeypatch)
    monkeypatch.setenv("TRUSTED_PROXIES", "10.0.0.0/8")
    import server.config as config_module

    monkeypatch.setattr(config_module, "_settings", None)
    yield
    monkeypatch.setattr(config_module, "_settings", None)


class TestGetKeyForRateLimit:
    def test_xff_used_when_peer_is_trusted_proxy(self, trusted_proxy_settings) -> None:
        req = _request("10.0.0.7", {"x-forwarded-for": "1.2.3.4"})
        assert _get_key_for_rate_limit(req) == "1.2.3.4"

    def test_xff_ignored_from_untrusted_peer(self, trusted_proxy_settings) -> None:
        req = _request("42.42.42.42", {"x-forwarded-for": "1.2.3.4"})
        assert _get_key_for_rate_limit(req) == "42.42.42.42"

    def test_peer_used_when_no_xff(self, trusted_proxy_settings) -> None:
        assert _get_key_for_rate_limit(_request("10.0.0.7")) == "10.0.0.7"

    def test_peer_used_when_xff_malformed(self, trusted_proxy_settings) -> None:
        req = _request("10.0.0.7", {"x-forwarded-for": "junk-value"})
        assert _get_key_for_rate_limit(req) == "10.0.0.7"

    def test_no_client_returns_unknown(self, trusted_proxy_settings) -> None:
        assert _get_key_for_rate_limit(_request(None)) == "unknown"

    def test_without_trusted_proxies_peer_always_wins(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from .conftest import _patch_env_and_settings

        _patch_env_and_settings(monkeypatch)
        monkeypatch.delenv("TRUSTED_PROXIES", raising=False)
        import server.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)
        req = _request("10.0.0.7", {"x-forwarded-for": "1.2.3.4"})
        assert _get_key_for_rate_limit(req) == "10.0.0.7"


class TestTrustedProxiesConfig:
    def test_invalid_cidr_fails_fast(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from .conftest import _patch_env_and_settings

        _patch_env_and_settings(monkeypatch)
        monkeypatch.setenv("TRUSTED_PROXIES", "not-a-cidr")
        import server.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)
        from server.config import get_settings

        with pytest.raises(ValueError, match="TRUSTED_PROXIES"):
            _ = get_settings().parsed_trusted_proxies
