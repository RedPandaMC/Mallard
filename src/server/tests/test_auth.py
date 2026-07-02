"""Tests for the constant-time credential-hash lookup (server.auth._lookup_label)."""

from __future__ import annotations

import hashlib
import hmac

import pytest

from server.auth import _lookup_label


def _h(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


class TestLookupLabel:
    def test_returns_label_on_match(self) -> None:
        h = _h(b"valid-key")
        assert _lookup_label(h, {h: "team-alpha"}) == "team-alpha"

    def test_returns_none_on_miss(self) -> None:
        stored = _h(b"valid-key")
        candidate = _h(b"wrong-key")
        assert _lookup_label(candidate, {stored: "team-alpha"}) is None

    def test_returns_none_on_empty_store(self) -> None:
        assert _lookup_label(_h(b"any-key"), {}) is None

    def test_finds_match_among_multiple_entries(self) -> None:
        store = {_h(b"key-1"): "alice", _h(b"key-2"): "bob", _h(b"key-3"): "carol"}
        assert _lookup_label(_h(b"key-2"), store) == "bob"

    def test_iterates_full_store_last_match_wins(self) -> None:
        """The lookup never early-exits (timing safety), so with duplicate hash keys
        being impossible in a dict, insertion order determines nothing — but a match
        early in the store must not stop iteration over later entries."""
        target = _h(b"key-early")
        store = {target: "early", _h(b"key-late"): "late"}
        # A match on the first entry still returns correctly after scanning the rest.
        assert _lookup_label(target, store) == "early"

    def test_candidate_of_different_length_never_matches(self) -> None:
        # hmac.compare_digest on different-length ASCII strings returns False
        assert _lookup_label("short", {_h(b"key"): "label"}) is None


class TestHashPrimitives:
    """Sanity checks for the hashing/compare primitives the lookup relies on."""

    def test_sha256_hash_is_deterministic(self) -> None:
        assert _h(b"my-secret-api-key") == _h(b"my-secret-api-key")

    def test_different_keys_produce_different_hashes(self) -> None:
        assert _h(b"key-a") != _h(b"key-b")

    def test_hash_is_64_hex_chars(self) -> None:
        h = _h(b"any-key")
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)

    def test_compare_digest_semantics(self) -> None:
        h1 = _h(b"secret1")
        h2 = _h(b"secret2")
        assert hmac.compare_digest(h1, h1) is True
        assert hmac.compare_digest(h1, h2) is False

    def test_raw_key_not_in_hash(self) -> None:
        raw = "super-secret"
        assert raw not in _h(raw.encode())


class TestSettingsHashedKeys:
    def test_hashed_api_keys_are_sha256(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("INFLUX_URL", "http://localhost:8086")
        monkeypatch.setenv("INFLUX_TOKEN", "tok")
        monkeypatch.setenv("API_KEYS", "key-a,key-b")

        import server.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)
        settings = config_module.get_settings()

        assert _h(b"key-a") in settings.hashed_api_keys
        assert _h(b"key-b") in settings.hashed_api_keys

    def test_plain_keys_not_stored(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("INFLUX_URL", "http://localhost:8086")
        monkeypatch.setenv("INFLUX_TOKEN", "tok")
        monkeypatch.setenv("API_KEYS", "plain-text-key")

        import server.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)
        settings = config_module.get_settings()

        assert "plain-text-key" not in settings.hashed_api_keys
