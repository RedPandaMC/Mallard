"""Tests for API key authentication logic."""

from __future__ import annotations

import hashlib
import hmac

import pytest


class TestHashVerification:
    def test_sha256_hash_is_deterministic(self) -> None:
        key = "my-secret-api-key"
        h1 = hashlib.sha256(key.encode()).hexdigest()
        h2 = hashlib.sha256(key.encode()).hexdigest()
        assert h1 == h2

    def test_different_keys_produce_different_hashes(self) -> None:
        h1 = hashlib.sha256(b"key-a").hexdigest()
        h2 = hashlib.sha256(b"key-b").hexdigest()
        assert h1 != h2

    def test_hash_is_64_hex_chars(self) -> None:
        h = hashlib.sha256(b"any-key").hexdigest()
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)


class TestConstantTimeComparison:
    def test_compare_digest_true_for_equal_strings(self) -> None:
        h = hashlib.sha256(b"secret").hexdigest()
        assert hmac.compare_digest(h, h) is True

    def test_compare_digest_false_for_different_strings(self) -> None:
        h1 = hashlib.sha256(b"secret1").hexdigest()
        h2 = hashlib.sha256(b"secret2").hexdigest()
        assert hmac.compare_digest(h1, h2) is False

    def test_compare_digest_different_lengths_returns_false(self) -> None:
        # Python 3.12+: compare_digest on strings of different lengths returns False
        assert hmac.compare_digest("short", "a" * 64) is False


class TestAuthModule:
    """Unit tests for src.auth functions."""

    def test_hash_key_returns_sha256_hex(self) -> None:
        from src.auth import _hash_key

        raw = "my-api-key"
        result = _hash_key(raw)
        expected = hashlib.sha256(raw.encode()).hexdigest()
        assert result == expected

    def test_constant_time_match_valid_key(self) -> None:
        from src.auth import _constant_time_match

        h = hashlib.sha256(b"valid-key").hexdigest()
        assert _constant_time_match(h, {h}) is True

    def test_constant_time_match_invalid_key(self) -> None:
        from src.auth import _constant_time_match

        stored = hashlib.sha256(b"valid-key").hexdigest()
        candidate = hashlib.sha256(b"wrong-key").hexdigest()
        assert _constant_time_match(candidate, {stored}) is False

    def test_constant_time_match_empty_set(self) -> None:
        from src.auth import _constant_time_match

        h = hashlib.sha256(b"any-key").hexdigest()
        assert _constant_time_match(h, set()) is False

    def test_constant_time_match_multiple_keys(self) -> None:
        from src.auth import _constant_time_match

        h1 = hashlib.sha256(b"key-1").hexdigest()
        h2 = hashlib.sha256(b"key-2").hexdigest()
        h3 = hashlib.sha256(b"key-3").hexdigest()
        # h2 is in the set
        assert _constant_time_match(h2, {h1, h2, h3}) is True

    def test_raw_key_not_in_hash(self) -> None:
        """Ensure the stored value is a hex digest, not the raw key."""
        raw = "super-secret"
        h = hashlib.sha256(raw.encode()).hexdigest()
        assert raw not in h  # sanity check — the hash should not contain the plaintext key


class TestSettingsHashedKeys:
    def test_hashed_api_keys_are_sha256(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("INFLUX_URL", "http://localhost:8086")
        monkeypatch.setenv("INFLUX_TOKEN", "tok")
        monkeypatch.setenv("API_KEYS", "key-a,key-b")

        import src.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)
        settings = config_module.get_settings()

        expected_a = hashlib.sha256(b"key-a").hexdigest()
        expected_b = hashlib.sha256(b"key-b").hexdigest()
        assert expected_a in settings.hashed_api_keys
        assert expected_b in settings.hashed_api_keys

    def test_plain_keys_not_stored(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("INFLUX_URL", "http://localhost:8086")
        monkeypatch.setenv("INFLUX_TOKEN", "tok")
        monkeypatch.setenv("API_KEYS", "plain-text-key")

        import src.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)
        settings = config_module.get_settings()

        assert "plain-text-key" not in settings.hashed_api_keys
