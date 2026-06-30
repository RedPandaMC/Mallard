"""100% coverage tests for src.credential_verifier."""

from __future__ import annotations

import asyncio
import hashlib
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ── CredentialStore.parse_labeled ─────────────────────────────────────────────


class TestCredentialStoreParseLabled:
    def test_labeled_entry(self) -> None:
        from src.credential_verifier import CredentialStore

        result = CredentialStore.parse_labeled("team-alpha:mykey")
        h = hashlib.sha256(b"mykey").hexdigest()
        assert result == {h: "team-alpha"}

    def test_bare_entry_gets_unknown_label(self) -> None:
        from src.credential_verifier import CredentialStore

        result = CredentialStore.parse_labeled("bare-key")
        h = hashlib.sha256(b"bare-key").hexdigest()
        assert result == {h: "unknown"}

    def test_empty_string_returns_empty_dict(self) -> None:
        from src.credential_verifier import CredentialStore

        assert CredentialStore.parse_labeled("") == {}

    def test_whitespace_only_entries_skipped(self) -> None:
        from src.credential_verifier import CredentialStore

        assert CredentialStore.parse_labeled("  ,  ,  ") == {}

    def test_multiple_entries_parsed(self) -> None:
        from src.credential_verifier import CredentialStore

        result = CredentialStore.parse_labeled("alice:pass1,bob:pass2")
        h1 = hashlib.sha256(b"pass1").hexdigest()
        h2 = hashlib.sha256(b"pass2").hexdigest()
        assert result[h1] == "alice"
        assert result[h2] == "bob"

    def test_label_whitespace_stripped(self) -> None:
        from src.credential_verifier import CredentialStore

        result = CredentialStore.parse_labeled("  team-x  :secret")
        h = hashlib.sha256(b"secret").hexdigest()
        assert result[h] == "team-x"

    def test_mixed_bare_and_labeled(self) -> None:
        from src.credential_verifier import CredentialStore

        result = CredentialStore.parse_labeled("bare,labeled:key")
        h_bare = hashlib.sha256(b"bare").hexdigest()
        h_labeled = hashlib.sha256(b"key").hexdigest()
        assert result[h_bare] == "unknown"
        assert result[h_labeled] == "labeled"


# ── StaticCredentialVerifier ──────────────────────────────────────────────────


class TestStaticCredentialVerifier:
    def _make_settings(self, api_keys: dict[str, str], mqtt_creds: dict[str, str]) -> MagicMock:
        s = MagicMock()
        s.hashed_api_keys = api_keys
        s.hashed_mqtt_credentials = mqtt_creds
        return s

    async def test_verify_api_key_valid(self) -> None:
        from src.credential_verifier import StaticCredentialVerifier, VerifiedIdentity

        h = hashlib.sha256(b"good-key").hexdigest()
        verifier = StaticCredentialVerifier(self._make_settings({h: "my-label"}, {}))
        result = await verifier.verify_api_key("good-key")
        assert result == VerifiedIdentity(label="my-label")

    async def test_verify_api_key_invalid(self) -> None:
        from src.credential_verifier import StaticCredentialVerifier

        h = hashlib.sha256(b"good-key").hexdigest()
        verifier = StaticCredentialVerifier(self._make_settings({h: "label"}, {}))
        result = await verifier.verify_api_key("wrong-key")
        assert result is None

    async def test_verify_api_key_empty_store(self) -> None:
        from src.credential_verifier import StaticCredentialVerifier

        verifier = StaticCredentialVerifier(self._make_settings({}, {}))
        assert await verifier.verify_api_key("any") is None

    async def test_verify_mqtt_credential_valid(self) -> None:
        from src.credential_verifier import StaticCredentialVerifier, VerifiedIdentity

        h = hashlib.sha256(b"mqtt-pass").hexdigest()
        verifier = StaticCredentialVerifier(self._make_settings({}, {h: "device-1"}))
        result = await verifier.verify_mqtt_credential("mqtt-pass")
        assert result == VerifiedIdentity(label="device-1")

    async def test_verify_mqtt_credential_invalid(self) -> None:
        from src.credential_verifier import StaticCredentialVerifier

        h = hashlib.sha256(b"mqtt-pass").hexdigest()
        verifier = StaticCredentialVerifier(self._make_settings({}, {h: "device-1"}))
        result = await verifier.verify_mqtt_credential("wrong-pass")
        assert result is None

    async def test_verify_mqtt_credential_empty_store(self) -> None:
        from src.credential_verifier import StaticCredentialVerifier

        verifier = StaticCredentialVerifier(self._make_settings({}, {}))
        assert await verifier.verify_mqtt_credential("any") is None


# ── RemoteCredentialVerifier caching (via InfisicalCredentialVerifier) ─────────


class TestRemoteCredentialVerifierCaching:
    def _make_infisical_verifier(self, ttl: int = 30):
        from src.credential_verifier import InfisicalCredentialVerifier

        s = MagicMock()
        s.secret_manager_url = "http://infisical"
        s.secret_manager_token = "tok"
        s.secret_manager_ca_cert_path = ""
        s.infisical_project_id = "proj"
        s.infisical_env_slug = "prod"
        v = InfisicalCredentialVerifier(s, ttl_seconds=ttl)
        return v

    def _mock_store(self, api_key: str = "key", label: str = "lbl"):
        from src.credential_verifier import CredentialStore

        h = hashlib.sha256(api_key.encode()).hexdigest()
        return CredentialStore(
            api_keys={h: label},
            mqtt_credentials={},
        )

    async def test_fetch_store_called_on_first_access(self) -> None:
        verifier = self._make_infisical_verifier()
        store = self._mock_store()

        with patch.object(verifier, "_fetch_store", new=AsyncMock(return_value=store)) as mock_fetch:
            await verifier._get_store()
            mock_fetch.assert_called_once()

    async def test_cache_used_within_ttl(self) -> None:
        verifier = self._make_infisical_verifier(ttl=60)
        store = self._mock_store()

        with patch.object(verifier, "_fetch_store", new=AsyncMock(return_value=store)) as mock_fetch:
            await verifier._get_store()
            await verifier._get_store()
            mock_fetch.assert_called_once()  # only fetched once

    async def test_refetch_after_ttl_expires(self) -> None:
        verifier = self._make_infisical_verifier(ttl=0)  # TTL = 0 always expires
        store = self._mock_store()

        with patch.object(verifier, "_fetch_store", new=AsyncMock(return_value=store)) as mock_fetch:
            await verifier._get_store()
            # Force TTL expiry by resetting fetched_at to distant past
            from src.credential_verifier import CredentialStore

            old_store = CredentialStore(fetched_at=time.monotonic() - 100)
            verifier._store = old_store
            await verifier._get_store()
            assert mock_fetch.call_count == 2

    async def test_concurrent_calls_fetch_once(self) -> None:
        """Lock prevents thundering herd — only one fetch even under concurrency."""
        verifier = self._make_infisical_verifier(ttl=60)
        store = self._mock_store()

        fetch_count = 0

        async def slow_fetch():
            nonlocal fetch_count
            fetch_count += 1
            await asyncio.sleep(0.05)
            return store

        with patch.object(verifier, "_fetch_store", new=slow_fetch):
            await asyncio.gather(*[verifier._get_store() for _ in range(5)])

        assert fetch_count == 1

    async def test_verify_api_key_via_cached_store(self) -> None:
        from src.credential_verifier import VerifiedIdentity

        verifier = self._make_infisical_verifier()
        store = self._mock_store(api_key="my-key", label="my-team")

        with patch.object(verifier, "_fetch_store", new=AsyncMock(return_value=store)):
            result = await verifier.verify_api_key("my-key")
        assert result == VerifiedIdentity(label="my-team")

    async def test_verify_mqtt_via_cached_store(self) -> None:
        from src.credential_verifier import CredentialStore, VerifiedIdentity

        verifier = self._make_infisical_verifier()
        h = hashlib.sha256(b"mqtt-pass").hexdigest()
        store = CredentialStore(api_keys={}, mqtt_credentials={h: "sensor-1"})

        with patch.object(verifier, "_fetch_store", new=AsyncMock(return_value=store)):
            result = await verifier.verify_mqtt_credential("mqtt-pass")
        assert result == VerifiedIdentity(label="sensor-1")


# ── InfisicalCredentialVerifier._fetch_store ──────────────────────────────────


class TestInfisicalFetchStore:
    def _make_settings(self):
        s = MagicMock()
        s.secret_manager_url = "http://infisical"
        s.secret_manager_token = "tok"
        s.secret_manager_ca_cert_path = ""
        s.infisical_project_id = "proj-123"
        s.infisical_env_slug = "prod"
        return s

    async def test_success_parses_response(self) -> None:
        from src.credential_verifier import InfisicalCredentialVerifier

        response_json = {
            "secrets": [
                {"secretKey": "API_KEYS", "secretValue": "team-a:key-a"},
                {"secretKey": "MQTT_CREDENTIALS", "secretValue": "device-1:pass-1"},
            ]
        }

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json = MagicMock(return_value=response_json)

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_response)

        with patch("src.credential_verifier.httpx.AsyncClient", return_value=mock_client):
            verifier = InfisicalCredentialVerifier(self._make_settings())
            store = await verifier._fetch_store()

        h = hashlib.sha256(b"key-a").hexdigest()
        assert store.api_keys[h] == "team-a"
        hm = hashlib.sha256(b"pass-1").hexdigest()
        assert store.mqtt_credentials[hm] == "device-1"

    async def test_missing_keys_graceful(self) -> None:
        from src.credential_verifier import InfisicalCredentialVerifier

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json = MagicMock(return_value={"secrets": []})

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_response)

        with patch("src.credential_verifier.httpx.AsyncClient", return_value=mock_client):
            verifier = InfisicalCredentialVerifier(self._make_settings())
            store = await verifier._fetch_store()

        assert store.api_keys == {}
        assert store.mqtt_credentials == {}

    async def test_http_error_raises(self) -> None:
        from src.credential_verifier import InfisicalCredentialVerifier

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock(
            side_effect=Exception("HTTP 401 Unauthorized")
        )

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_response)

        with patch("src.credential_verifier.httpx.AsyncClient", return_value=mock_client):
            verifier = InfisicalCredentialVerifier(self._make_settings())
            with pytest.raises(Exception):
                await verifier._fetch_store()

    async def test_network_error_raises(self) -> None:
        from src.credential_verifier import InfisicalCredentialVerifier

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(side_effect=httpx.ConnectError("refused"))

        with patch("src.credential_verifier.httpx.AsyncClient", return_value=mock_client):
            verifier = InfisicalCredentialVerifier(self._make_settings())
            with pytest.raises(httpx.ConnectError):
                await verifier._fetch_store()

    async def test_uses_ca_cert_path_when_set(self) -> None:
        from src.credential_verifier import InfisicalCredentialVerifier

        s = self._make_settings()
        s.secret_manager_ca_cert_path = "/path/to/ca.crt"

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json = MagicMock(return_value={"secrets": []})

        captured_verify: list = []

        class _FakeClient:
            def __init__(self, **kwargs):
                captured_verify.append(kwargs.get("verify"))

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                pass

            async def get(self, *args, **kwargs):
                return mock_response

        with patch("src.credential_verifier.httpx.AsyncClient", _FakeClient):
            verifier = InfisicalCredentialVerifier(s)
            await verifier._fetch_store()

        assert captured_verify[0] == "/path/to/ca.crt"


# ── OpenBaoCredentialVerifier._fetch_store ────────────────────────────────────


class TestOpenBaoFetchStore:
    def _make_settings(self, namespace: str = ""):
        s = MagicMock()
        s.secret_manager_url = "http://openbao:8200"
        s.secret_manager_token = "root"
        s.secret_manager_ca_cert_path = ""
        s.openbao_secret_path = "secret/data/mallard/server"
        s.openbao_namespace = namespace
        return s

    def _mock_response(self, api_keys: str = "", mqtt: str = "") -> MagicMock:
        r = MagicMock()
        r.raise_for_status = MagicMock()
        r.json = MagicMock(return_value={
            "data": {"data": {"api_keys": api_keys, "mqtt_credentials": mqtt}}
        })
        return r

    async def test_success_parses_kv_response(self) -> None:
        from src.credential_verifier import OpenBaoCredentialVerifier

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=self._mock_response("team:k", "dev:p"))

        with patch("src.credential_verifier.httpx.AsyncClient", return_value=mock_client):
            verifier = OpenBaoCredentialVerifier(self._make_settings())
            store = await verifier._fetch_store()

        hk = hashlib.sha256(b"k").hexdigest()
        hp = hashlib.sha256(b"p").hexdigest()
        assert store.api_keys[hk] == "team"
        assert store.mqtt_credentials[hp] == "dev"

    async def test_namespace_header_sent_when_set(self) -> None:
        from src.credential_verifier import OpenBaoCredentialVerifier

        captured_headers: list = []

        class _FakeClient:
            def __init__(self, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                pass

            async def get(self, url, headers=None):
                captured_headers.append(dict(headers or {}))
                r = MagicMock()
                r.raise_for_status = MagicMock()
                r.json = MagicMock(return_value={"data": {"data": {}}})
                return r

        with patch("src.credential_verifier.httpx.AsyncClient", _FakeClient):
            verifier = OpenBaoCredentialVerifier(self._make_settings(namespace="ns1"))
            await verifier._fetch_store()

        assert captured_headers[0].get("X-Vault-Namespace") == "ns1"

    async def test_no_namespace_header_when_empty(self) -> None:
        from src.credential_verifier import OpenBaoCredentialVerifier

        captured_headers: list = []

        class _FakeClient:
            def __init__(self, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                pass

            async def get(self, url, headers=None):
                captured_headers.append(dict(headers or {}))
                r = MagicMock()
                r.raise_for_status = MagicMock()
                r.json = MagicMock(return_value={"data": {"data": {}}})
                return r

        with patch("src.credential_verifier.httpx.AsyncClient", _FakeClient):
            verifier = OpenBaoCredentialVerifier(self._make_settings(namespace=""))
            await verifier._fetch_store()

        assert "X-Vault-Namespace" not in captured_headers[0]

    async def test_http_error_raises(self) -> None:
        from src.credential_verifier import OpenBaoCredentialVerifier

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock(side_effect=Exception("HTTP 403"))

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_response)

        with patch("src.credential_verifier.httpx.AsyncClient", return_value=mock_client):
            verifier = OpenBaoCredentialVerifier(self._make_settings())
            with pytest.raises(Exception):
                await verifier._fetch_store()

    async def test_network_error_raises(self) -> None:
        from src.credential_verifier import OpenBaoCredentialVerifier

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(side_effect=httpx.ConnectError("refused"))

        with patch("src.credential_verifier.httpx.AsyncClient", return_value=mock_client):
            verifier = OpenBaoCredentialVerifier(self._make_settings())
            with pytest.raises(httpx.ConnectError):
                await verifier._fetch_store()


# ── create_verifier factory ────────────────────────────────────────────────────


class TestCreateVerifierFactory:
    def _make_settings(self, sm_type: str):
        s = MagicMock()
        s.secret_manager_type = sm_type
        return s

    def test_empty_type_returns_static(self) -> None:
        from src.credential_verifier import StaticCredentialVerifier, create_verifier

        result = create_verifier(self._make_settings(""))
        assert isinstance(result, StaticCredentialVerifier)

    def test_infisical_type_returns_infisical(self) -> None:
        from src.credential_verifier import InfisicalCredentialVerifier, create_verifier

        result = create_verifier(self._make_settings("infisical"))
        assert isinstance(result, InfisicalCredentialVerifier)

    def test_openbao_type_returns_openbao(self) -> None:
        from src.credential_verifier import OpenBaoCredentialVerifier, create_verifier

        result = create_verifier(self._make_settings("openbao"))
        assert isinstance(result, OpenBaoCredentialVerifier)


# ── VerifiedIdentity ──────────────────────────────────────────────────────────


class TestVerifiedIdentity:
    def test_equality(self) -> None:
        from src.credential_verifier import VerifiedIdentity

        assert VerifiedIdentity("a") == VerifiedIdentity("a")
        assert VerifiedIdentity("a") != VerifiedIdentity("b")

    def test_immutable(self) -> None:
        from src.credential_verifier import VerifiedIdentity

        identity = VerifiedIdentity("label")
        with pytest.raises((AttributeError, TypeError)):
            identity.label = "other"  # type: ignore[misc]


# ── CredentialStore defaults ──────────────────────────────────────────────────


class TestCredentialStoreDefaults:
    def test_default_empty_dicts(self) -> None:
        from src.credential_verifier import CredentialStore

        store = CredentialStore()
        assert store.api_keys == {}
        assert store.mqtt_credentials == {}

    def test_fetched_at_is_recent(self) -> None:
        from src.credential_verifier import CredentialStore

        before = time.monotonic()
        store = CredentialStore()
        after = time.monotonic()
        assert before <= store.fetched_at <= after


# need httpx imported for the network error tests
import httpx  # noqa: E402
